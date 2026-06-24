import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { redisClient, scripts } from '../redis.js';

const router = Router();

const SESSION_TTL_SECONDS = 1800;

/**
 * POST /api/sessions
 * Creates a new session for a user, atomically invalidating any previous sessions.
 *
 * Body: { userId, ipAddress, deviceType }
 * Response 201: { sessionId }
 */
router.post('/sessions', async (req, res, next) => {
  try {
    const { userId, ipAddress, deviceType } = req.body;

    // Validate required fields
    if (!userId || !ipAddress || !deviceType) {
      return res.status(400).json({
        error: 'Missing required fields: userId, ipAddress, deviceType',
      });
    }

    const sessionId = uuidv4();
    const now = new Date().toISOString();

    const userSessionsKey = `user_sessions:${userId}`;
    const sessionKey = `session:${sessionId}`;

    // Atomically invalidate all existing sessions, register new session, write session hash, and set TTL in one script execution
    const invalidatedSessionIds = await redisClient.eval(
      scripts.invalidateSessions,
      1,
      userSessionsKey,
      sessionId,
      sessionKey,
      SESSION_TTL_SECONDS,
      userId,
      now,
      now,
      ipAddress,
      deviceType
    );

    // Publish session_deleted events for each session that was invalidated
    if (Array.isArray(invalidatedSessionIds)) {
      for (const oldSid of invalidatedSessionIds) {
        const deleteEvent = JSON.stringify({ type: 'session_deleted', userId, sessionId: oldSid });
        await redisClient.publish('game-events', deleteEvent);
      }
    }

    // Publish session_created event for the newly registered session
    const createEvent = JSON.stringify({
      type: 'session_created',
      userId,
      sessionId,
      ipAddress,
      deviceType
    });
    await redisClient.publish('game-events', createEvent);

    res.status(201).json({ sessionId });
  } catch (err) {
    next(err);
  }
});

export default router;
