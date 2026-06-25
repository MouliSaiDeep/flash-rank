import { Router } from 'express';
import { redisClient, scripts } from '../redis.js';

const router = Router();

const LEADERBOARD_KEY = 'leaderboard:global';

/**
 * POST /api/game/submit
 * Atomically processes an answer submission using the submitAnswer Lua script.
 *
 * Body: { gameId, roundId, playerId, answer }
 * Response 200: { status: "SUCCESS", newScore }
 * Response 400: { status: "ERROR", code: "DUPLICATE_SUBMISSION" }
 * Response 403: { status: "ERROR", code: "ROUND_EXPIRED" }
 */
router.post('/submit', async (req, res, next) => {
  try {
    const { gameId, roundId, playerId, answer } = req.body;

    if (!gameId || !roundId || !playerId || answer === undefined || answer === null) {
      return res.status(400).json({
        error: 'Missing required fields: gameId, roundId, playerId, answer',
      });
    }

    const roundKey = `game_round:${gameId}:${roundId}`;
    const submissionsKey = `submissions:${gameId}:${roundId}`;
    const currentTime = Date.now();

    const result = await redisClient.eval(
      scripts.submitAnswer,
      3,
      roundKey,
      submissionsKey,
      LEADERBOARD_KEY,
      playerId,
      String(answer),
      String(currentTime)
    );

    const code = parseInt(result[0], 10);
    const payload = result[1];

    if (code === 1) {
      const newScore = parseFloat(payload);
      // Publish event to game-events channel to sync live dashboards
      const event = JSON.stringify({ type: 'leaderboard_updated', playerId, newScore });
      await redisClient.publish('game-events', event);

      return res.status(200).json({ status: 'SUCCESS', newScore });
    } else if (code === -1) {
      return res.status(403).json({ status: 'ERROR', code: 'ROUND_EXPIRED' });
    } else if (code === -2) {
      return res.status(400).json({ status: 'ERROR', code: 'DUPLICATE_SUBMISSION' });
    } else {
      return res.status(500).json({ error: 'Unexpected result from game script' });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/game/rounds
 * Seeds a game round into Redis for testing purposes.
 *
 * Body: { gameId, roundId, correctAnswer, points, durationMs }
 * Response 201: { message, roundKey, endTime }
 */
router.post('/rounds', async (req, res, next) => {
  try {
    const { gameId, roundId, correctAnswer, points, durationMs } = req.body;

    if (!gameId || !roundId || !correctAnswer || points === undefined || !durationMs) {
      return res.status(400).json({
        error: 'Missing required fields: gameId, roundId, correctAnswer, points, durationMs',
      });
    }

    const endTime = Date.now() + Number(durationMs);
    const roundKey = `game_round:${gameId}:${roundId}`;

    await redisClient.hset(roundKey, {
      endTime: String(endTime),
      correctAnswer: String(correctAnswer),
      points: String(Number(points)),
    });

    const formattedEndTime = new Date(endTime).toISOString();

    // Publish event to game-events channel to notify subscribers that a new round started
    const event = JSON.stringify({ type: 'round_started', gameId, roundId, endTime: formattedEndTime });
    await redisClient.publish('game-events', event);

    res.status(201).json({
      message: 'Round seeded successfully',
      roundKey,
      endTime: formattedEndTime,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
