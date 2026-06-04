const Sentry = require("@sentry/node");
const { v4: uuidv4 } = require("uuid");

/**
 * Sets request-scoped attributes on Sentry's isolation scope so every log,
 * span, and error in this request carries request_id (and optionally path/method).
 * Must run early, after CORS/helmet, before route handlers.
 */
function sentryContextMiddleware(req, res, next) {
  const requestId = req.id || req.headers["x-request-id"] || uuidv4();
  req.id = requestId;

  Sentry.getIsolationScope().setAttributes({
    request_id: requestId,
    "request.path": req.path,
    "request.method": req.method,
  });

  next();
}

module.exports = sentryContextMiddleware;
