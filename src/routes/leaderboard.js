import { Router } from 'express';
import { redisClient } from '../redis.js';

const router = Router();

const LEADERBOARD_KEY = 'leaderboard:global';
const GAME_EVENTS_CHANNEL = 'game-events';

/**
 * POST /api/leaderboard/scores
 * Atomically increments a player's score and publishes a leaderboard_updated event.
 *
 * Body: { playerId, points }
 * Response 200: { playerId, newScore }
 */
router.post('/scores', async (req, res, next) => {
  try {
    const { playerId, points } = req.body;

    if (!playerId || points === undefined || points === null) {
      return res.status(400).json({ error: 'Missing required fields: playerId, points' });
    }

    const numericPoints = Number(points);
    if (isNaN(numericPoints)) {
      return res.status(400).json({ error: 'points must be a number' });
    }

    // Atomically increment score
    const newScoreStr = await redisClient.zincrby(LEADERBOARD_KEY, numericPoints, playerId);
    const newScore = parseFloat(newScoreStr);

    // Publish event to game-events channel
    const event = JSON.stringify({ type: 'leaderboard_updated', playerId, newScore });
    await redisClient.publish(GAME_EVENTS_CHANNEL, event);

    res.status(200).json({ playerId, newScore });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/leaderboard/top/:count
 * Returns the top N players sorted by score descending.
 *
 * Response 200: [{ rank, playerId, score }, ...]
 */
router.get('/top/:count', async (req, res, next) => {
  try {
    const count = parseInt(req.params.count, 10);

    if (isNaN(count) || count < 1) {
      return res.status(400).json({ error: 'count must be a positive integer' });
    }

    // ZREVRANGE returns members + scores when WITHSCORES is used
    const raw = await redisClient.zrevrange(LEADERBOARD_KEY, 0, count - 1, 'WITHSCORES');

    // raw = ['player1', '500', 'player2', '480', ...]
    const players = [];
    for (let i = 0; i < raw.length; i += 2) {
      players.push({
        rank: players.length + 1,
        playerId: raw[i],
        score: parseFloat(raw[i + 1]),
      });
    }

    res.status(200).json(players);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/leaderboard/player/:playerId
 * Returns a player's rank, percentile, score, and 2 players above/below them.
 *
 * Response 200: { playerId, score, rank, percentile, nearbyPlayers: { above, below } }
 * Response 404: player not found
 */
router.get('/player/:playerId', async (req, res, next) => {
  try {
    const { playerId } = req.params;

    // Run score, rank, and total count queries in parallel
    const [scoreStr, zeroIndexRank, totalPlayers] = await Promise.all([
      redisClient.zscore(LEADERBOARD_KEY, playerId),
      redisClient.zrevrank(LEADERBOARD_KEY, playerId),
      redisClient.zcard(LEADERBOARD_KEY),
    ]);

    if (scoreStr === null || zeroIndexRank === null) {
      return res.status(404).json({ error: 'Player not found in leaderboard' });
    }

    const score = parseFloat(scoreStr);
    const rank = zeroIndexRank + 1; // 1-indexed

    // percentile: percentage of players the current player outscores
    const percentile =
      totalPlayers > 1
        ? parseFloat((((totalPlayers - rank) / totalPlayers) * 100).toFixed(1))
        : 100.0;

    // Fetch 2 players above (higher rank = lower 0-index)
    const aboveStart = Math.max(0, zeroIndexRank - 2);
    const aboveEnd = Math.max(0, zeroIndexRank - 1);

    // Fetch 2 players below (lower rank = higher 0-index)
    const belowStart = zeroIndexRank + 1;
    const belowEnd = zeroIndexRank + 2;

    const [aboveRaw, belowRaw] = await Promise.all([
      zeroIndexRank > 0
        ? redisClient.zrevrange(LEADERBOARD_KEY, aboveStart, aboveEnd, 'WITHSCORES')
        : Promise.resolve([]),
      redisClient.zrevrange(LEADERBOARD_KEY, belowStart, belowEnd, 'WITHSCORES'),
    ]);

    const parseEntries = (raw, startRank) => {
      const entries = [];
      for (let i = 0; i < raw.length; i += 2) {
        entries.push({
          rank: startRank + Math.floor(i / 2),
          playerId: raw[i],
          score: parseFloat(raw[i + 1]),
        });
      }
      return entries;
    };

    const above = parseEntries(aboveRaw, aboveStart + 1);
    const below = parseEntries(belowRaw, belowStart + 1);

    res.status(200).json({
      playerId,
      score,
      rank,
      percentile,
      nearbyPlayers: { above, below },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
