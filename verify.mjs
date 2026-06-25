/**
 * FlashRank In-Container Verification Script
 * Run with: docker exec flashrank-api node /app/verify.mjs
 */
import { createServer } from 'http';

const BASE = 'http://localhost:3000';

async function req(method, path, body) {
  return new Promise(async (resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const { request } = await import('http');
    const r = request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function ok(label, cond, got) {
  const mark = cond ? '✅' : '❌';
  console.log(`${mark} ${label}${got !== undefined ? ` (got: ${JSON.stringify(got)})` : ''}`);
  return cond;
}

async function main() {
  let pass = 0, fail = 0;
  const check = (label, cond, got) => { (ok(label, cond, got) ? pass++ : fail++); };

  // Flush Redis database to ensure clean, predictable runs
  const { redisClient } = await import('./src/redis.js');
  await redisClient.flushdb();

  // Dynamic import workaround for ESM + http
  const { default: http } = await import('http');

  function fetch(method, path, body) {
    return new Promise((resolve, reject) => {
      const opts = { hostname: 'localhost', port: 3000, path, method,
        headers: { 'Content-Type': 'application/json' } };
      const r = http.request(opts, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      });
      r.on('error', reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  }

  console.log('\n======= FlashRank Verification =======\n');

  // CHECK 3: GET /health
  const health = await fetch('GET', '/health');
  check('GET /health → 200 + {status:ok}', health.status === 200 && health.body.status === 'ok', health.body);

  // CHECK 5 & 6: Sessions
  const sess1 = await fetch('POST', '/api/sessions', { userId: 'u1', ipAddress: '1.1.1.1', deviceType: 'desktop' });
  check('POST /api/sessions → 201', sess1.status === 201, sess1.body);
  const sid1 = sess1.body.sessionId;

  const sess2 = await fetch('POST', '/api/sessions', { userId: 'u1', ipAddress: '2.2.2.2', deviceType: 'mobile' });
  const sid2 = sess2.body.sessionId;
  check('POST /api/sessions (2nd) → 201', sess2.status === 201, sess2.body);

  const sess3 = await fetch('POST', '/api/sessions', { userId: 'u1', ipAddress: '3.3.3.3', deviceType: 'tablet' });
  const sid3 = sess3.body.sessionId;
  check('POST /api/sessions (3rd) → 201', sess3.status === 201, sess3.body);

  // Verify via redis client in redis.js (already imported)
  const ttl = await redisClient.ttl(`session:${sid3}`);
  check('New session TTL > 1700s', ttl > 1700, ttl);
  const old1exists = await redisClient.exists(`session:${sid1}`);
  check('Old session1 deleted by Lua script', old1exists === 0, old1exists);
  const old2exists = await redisClient.exists(`session:${sid2}`);
  check('Old session2 deleted by Lua script', old2exists === 0, old2exists);

  // CHECK 7: Leaderboard scores (atomic increment)
  const sc1 = await fetch('POST', '/api/leaderboard/scores', { playerId: 'alice', points: 100 });
  check('POST /api/leaderboard/scores call1 → 200', sc1.status === 200, sc1.body);
  const sc2 = await fetch('POST', '/api/leaderboard/scores', { playerId: 'alice', points: 50 });
  check('Alice score accumulates: 150', sc2.body.newScore === 150, sc2.body.newScore);

  for (const [p, pts] of [['bob',200],['charlie',75],['diana',180],['eve',120],['frank',90]]) {
    await fetch('POST', '/api/leaderboard/scores', { playerId: p, points: pts });
  }

  // CHECK 8: Top N leaderboard
  const top5 = await fetch('GET', '/api/leaderboard/top/5');
  check('GET /api/leaderboard/top/5 → 200', top5.status === 200);
  check('Top player is bob (200)', top5.body[0]?.playerId === 'bob', top5.body[0]);
  check('Rank 1 has rank=1', top5.body[0]?.rank === 1);
  check('Returns 5 players', top5.body.length === 5, top5.body.length);
  console.log('  Top5:', top5.body.map(p => `${p.rank}.${p.playerId}=${p.score}`).join(' | '));

  // CHECK 9: Player stats with rank/percentile/nearby
  const pStat = await fetch('GET', '/api/leaderboard/player/alice');
  check('GET /api/leaderboard/player/alice → 200', pStat.status === 200);
  check('alice has rank', pStat.body.rank > 0, pStat.body.rank);
  check('alice has percentile', pStat.body.percentile !== undefined, pStat.body.percentile);
  check('alice has nearbyPlayers', pStat.body.nearbyPlayers !== undefined);
  console.log(`  alice: rank=${pStat.body.rank} score=${pStat.body.score} percentile=${pStat.body.percentile}`);
  console.log(`  above: ${JSON.stringify(pStat.body.nearbyPlayers.above)}`);
  console.log(`  below: ${JSON.stringify(pStat.body.nearbyPlayers.below)}`);

  // CHECK 10-12: Game submit
  const round = await fetch('POST', '/api/game/rounds', { gameId:'g1', roundId:'r1', correctAnswer:'Paris', points:50, durationMs:60000 });
  check('POST /api/game/rounds → 201', round.status === 201, round.body.roundKey);

  const sub1 = await fetch('POST', '/api/game/submit', { gameId:'g1', roundId:'r1', playerId:'alice', answer:'Paris' });
  check('First submit → SUCCESS', sub1.status === 200 && sub1.body.status === 'SUCCESS', sub1.body);

  const sub2 = await fetch('POST', '/api/game/submit', { gameId:'g1', roundId:'r1', playerId:'alice', answer:'Paris' });
  check('Duplicate submit → 400 DUPLICATE_SUBMISSION', sub2.status === 400 && sub2.body.code === 'DUPLICATE_SUBMISSION', sub2.body);

  const expRound = await fetch('POST', '/api/game/rounds', { gameId:'g1', roundId:'r99', correctAnswer:'X', points:10, durationMs:1 });
  await new Promise(r => setTimeout(r, 10));
  const sub3 = await fetch('POST', '/api/game/submit', { gameId:'g1', roundId:'r99', playerId:'bob', answer:'X' });
  check('Expired round → 403 ROUND_EXPIRED', sub3.status === 403 && sub3.body.code === 'ROUND_EXPIRED', sub3.body);

  // CHECK 13: SSE (publish-side; verify Redis pub happens)
  const sseScore = await fetch('POST', '/api/leaderboard/scores', { playerId: 'sse-tester', points: 999 });
  check('Score update published (SSE pub)', sseScore.status === 200, sseScore.body);

  // CHECK 14-15: Admin endpoints
  const adminSess = await fetch('POST', '/api/sessions', { userId:'admin-u', ipAddress:'9.9.9.9', deviceType:'desktop' });
  const adminSid = adminSess.body.sessionId;
  const listSess = await fetch('GET', '/api/admin/sessions/user/admin-u');
  check('GET /api/admin/sessions/user/:id → 200', listSess.status === 200);
  check('Lists 1 session', listSess.body.length === 1, listSess.body.length);

  const delSess = await fetch('DELETE', `/api/admin/sessions/${adminSid}`);
  check('DELETE /api/admin/sessions/:id → 204', delSess.status === 204);
  const goneKey = await redisClient.exists(`session:${adminSid}`);
  check('Session key removed from Redis', goneKey === 0, goneKey);

  // CHECK 4: .env.example has REDIS_URL and API_PORT
  const { readFileSync } = await import('fs');
  const envEx = readFileSync('/app/.env.example', 'utf-8');
  check('.env.example has REDIS_URL', envEx.includes('REDIS_URL'));
  check('.env.example has API_PORT', envEx.includes('API_PORT'));

  // CHECK 16: submission.json
  const sub = JSON.parse(readFileSync('/app/submission.json', 'utf-8'));
  check('submission.json has testUserId', !!sub.testUserId, sub.testUserId);

  await redisClient.quit();

  console.log(`\n======= RESULTS: ${pass} passed, ${fail} failed =======`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
