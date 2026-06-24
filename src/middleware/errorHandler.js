/**
 * Global Express error handler middleware.
 * Must be registered last (after all routes) in index.js.
 */
export function errorHandler(err, req, res, next) {
  // Log the full error server-side for debugging
  console.error('[ErrorHandler]', err.message, err.stack);

  // Avoid sending headers twice if response already started
  if (res.headersSent) {
    return next(err);
  }

  const status = err.status || err.statusCode || 500;
  const message =
    status === 500 ? 'Internal Server Error' : err.message || 'Internal Server Error';

  res.status(status).json({ error: message });
}
