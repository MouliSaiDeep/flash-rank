import { Router } from 'express';
import { redisClient } from '../redis.js';

const router = Router();

/**
 * GET /api/admin/sessions/user/:userId
 * Returns all active sessions for a given user.
 *
 * Response 200: [{ sessionId, ipAddress, lastActive, deviceType }, ...]
 */
router.get('/sessions/user/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const userSessionsKey = `user_sessions:${userId}`;

    // Fetch all session IDs in the user's set
    const sessionIds = await redisClient.smembers(userSessionsKey);

    if (sessionIds.length === 0) {
      return res.status(200).json([]);
    }

    // Fetch all session hashes in parallel
    const sessionDataList = await Promise.all(
      sessionIds.map((sessionId) => redisClient.hgetall(`session:${sessionId}`))
    );

    // Filter out expired sessions (HGETALL returns null/empty for missing keys)
    const activeSessions = [];
    for (let i = 0; i < sessionIds.length; i++) {
      const data = sessionDataList[i];
      if (data && Object.keys(data).length > 0) {
        activeSessions.push({
          sessionId: sessionIds[i],
          ipAddress: data.ipAddress,
          lastActive: data.lastActive,
          deviceType: data.deviceType,
        });
      }
    }

    res.status(200).json(activeSessions);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/sessions/:sessionId
 * Deletes a specific session and removes it from the user's session set.
 *
 * Response 204: No Content
 */
router.delete('/sessions/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const sessionKey = `session:${sessionId}`;

    // Retrieve the owning userId before deleting
    const userId = await redisClient.hget(sessionKey, 'userId');

    if (!userId) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Delete the session hash
    await redisClient.del(sessionKey);

    // Remove from the user's session set
    await redisClient.srem(`user_sessions:${userId}`, sessionId);

    // Publish session_deleted event to sync clients
    const event = JSON.stringify({ type: 'session_deleted', userId, sessionId });
    await redisClient.publish('game-events', event);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
