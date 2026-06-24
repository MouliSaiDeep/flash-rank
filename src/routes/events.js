import { Router } from 'express';
import { gameEventBus } from '../redis.js';

const router = Router();

/**
 * GET /api/events
 * Establishes a Server-Sent Events (SSE) connection.
 *
 * The subscriberClient in redis.js subscribes to the 'game-events' Redis channel
 * ONCE at startup and fans out messages via the gameEventBus EventEmitter.
 * Each SSE client attaches a listener to gameEventBus, avoiding one Redis
 * subscription per HTTP connection.
 */
router.get('/events', (req, res) => {
  // Set required SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if behind proxy
  res.flushHeaders();

  // Send an initial comment to establish the connection
  res.write(': connected\n\n');

  // Attach listener — each message is formatted per the SSE spec
  const listener = (data) => {
    const { type, ...payload } = data;
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  gameEventBus.on('game-event', listener);

  // Clean up on client disconnect
  req.on('close', () => {
    gameEventBus.off('game-event', listener);
  });
});

export default router;
