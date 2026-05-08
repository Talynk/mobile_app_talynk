/**
 * Request/response logging middleware. Runs after sentryContext (so req.id is set).
 * On response finish, writes one activity_log row with trace_id, route, method, status,
 * duration, IP, user agent, device fingerprint (if provided), and user id if authenticated.
 * Logging is fire-and-forget so it does not block the response.
 */

const { logRequest } = require('../logging/activityLogger');

function requestLoggerMiddleware(req, res, next) {
  const start = Date.now();

  function onFinish() {
    res.removeListener('finish', onFinish);
    res.removeListener('close', onFinish);
    const durationMs = Date.now() - start;
    logRequest(req, res, durationMs).catch((err) => {
      console.error('[requestLogger]', err.message);
    });
  }

  res.once('finish', onFinish);
  res.once('close', onFinish);
  next();
}

module.exports = requestLoggerMiddleware;
