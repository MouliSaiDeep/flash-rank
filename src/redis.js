import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Lua Scripts ─────────────────────────────────────────────────────────────
const invalidateSessionsScript = readFileSync(
  join(__dirname, 'scripts', 'invalidateSessions.lua'),
  'utf-8'
);

const submitAnswerScript = readFileSync(
  join(__dirname, 'scripts', 'submitAnswer.lua'),
  'utf-8'
);

// ─── Redis Clients ────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Primary client for all regular Redis commands (GET, SET, ZADD, EVAL, …).
 */
export const redisClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

/**
 * Dedicated subscriber client — once subscribed this connection can ONLY
 * receive messages; it cannot run other commands.
 */
export const subscriberClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

// ─── Event Bus ───────────────────────────────────────────────────────────────
/**
 * Local EventEmitter used to fan out Redis Pub/Sub messages to all connected
 * SSE clients without creating one Redis subscription per HTTP connection.
 */
export const gameEventBus = new EventEmitter();
gameEventBus.setMaxListeners(500); // allow many concurrent SSE clients

// ─── Cached Lua Script SHA strings ───────────────────────────────────────────
export const scripts = {
  invalidateSessions: invalidateSessionsScript,
  submitAnswer: submitAnswerScript,
};

// ─── Connectivity Check ───────────────────────────────────────────────────────
export async function connectRedis() {
  try {
    const pong = await redisClient.ping();
    console.log(`[Redis] redisClient connected — PING: ${pong}`);
  } catch (err) {
    console.error('[Redis] redisClient connection failed:', err.message);
    process.exit(1);
  }

  try {
    const pong = await subscriberClient.ping();
    console.log(`[Redis] subscriberClient connected — PING: ${pong}`);
  } catch (err) {
    console.error('[Redis] subscriberClient connection failed:', err.message);
    process.exit(1);
  }
}

// ─── Pub/Sub Fan-out (subscribe ONCE at module load) ─────────────────────────
subscriberClient.subscribe('game-events', (err, count) => {
  if (err) {
    console.error('[Redis] Failed to subscribe to game-events:', err.message);
  } else {
    console.log(`[Redis] Subscribed to game-events (total subscriptions: ${count})`);
  }
});

subscriberClient.on('message', (channel, message) => {
  if (channel === 'game-events') {
    try {
      const parsed = JSON.parse(message);
      gameEventBus.emit('game-event', parsed);
    } catch (err) {
      console.error('[Redis] Failed to parse game-events message:', err.message);
    }
  }
});

// ─── Error Handlers ───────────────────────────────────────────────────────────
redisClient.on('error', (err) => {
  console.error('[Redis] redisClient error:', err.message);
});

subscriberClient.on('error', (err) => {
  console.error('[Redis] subscriberClient error:', err.message);
});
