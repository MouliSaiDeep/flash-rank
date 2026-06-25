import 'dotenv/config';
import crypto from 'crypto';
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = crypto.webcrypto || crypto;
}
import express from 'express';

import { connectRedis } from './redis.js';
import { errorHandler } from './middleware/errorHandler.js';

import healthRouter from './routes/health.js';
import sessionsRouter from './routes/sessions.js';
import leaderboardRouter from './routes/leaderboard.js';
import gameRouter from './routes/game.js';
import eventsRouter from './routes/events.js';
import adminRouter from './routes/admin.js';

const PORT = process.env.API_PORT || 3000;

async function bootstrap() {
  // ── Verify Redis connectivity before accepting traffic ─────────────────────
  await connectRedis();

  // ── Express App Setup ──────────────────────────────────────────────────────
  const app = express();

  // Parse JSON bodies
  app.use(express.json());

  // Serve static frontend assets
  app.use(express.static('public'));

  // ── Routes ─────────────────────────────────────────────────────────────────
  // Health check (no /api prefix — required by healthcheck spec)
  app.use('/', healthRouter);

  // API routes
  app.use('/api', sessionsRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/game', gameRouter);
  app.use('/api', eventsRouter);
  app.use('/api/admin', adminRouter);

  // 404 handler for unknown routes
  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  // ── Global Error Handler (must be last) ───────────────────────────────────
  app.use(errorHandler);

  // ── Start Server ──────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`[FlashRank] API server running on http://localhost:${PORT}`);
    console.log(`[FlashRank] Health check: http://localhost:${PORT}/health`);
  });
}

bootstrap().catch((err) => {
  console.error('[FlashRank] Fatal startup error:', err);
  process.exit(1);
});
