import { Router } from 'express';
import { redisClient } from '../redis.js';

const router = Router();

/**
 * GET /health
 * Verifies Redis connectivity and returns service status.
 */
router.get('/health', async (req, res, next) => {
  try {
    const pong = await redisClient.ping();
    if (pong !== 'PONG') {
      return res.status(503).json({ status: 'error', detail: 'Redis unreachable' });
    }
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

export default router;
