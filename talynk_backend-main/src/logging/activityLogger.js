/**
 * Activity (trace-level) logger. Writes request/response and client events to activity_logs.
 */

const prisma = require('../lib/prisma');
const { getOrCreateDeviceFingerprint, parseDeviceMetadata } = require('./deviceFingerprintService');
const { runAnomalyRulesForActivity } = require('./logAnalyzer');

/**
 * Get client IP from request (supports X-Forwarded-For when behind proxy).
 * @param {import('express').Request} req
 * @returns {string|undefined}
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0];
    return first ? first.trim() : undefined;
  }
  return req.ip || req.socket?.remoteAddress;
}

/**
 * Resolve device_fingerprint_id from request headers.
 * Expects X-Device-Fingerprint (hash) and optionally X-Device-Metadata (JSON).
 * @param {import('express').Request} req
 * @returns {Promise<string|null>} DeviceFingerprint id or null.
 */
async function resolveDeviceFingerprintId(req) {
  const hash = req.headers['x-device-fingerprint'];
  if (!hash) return null;
  const metadata = parseDeviceMetadata(req.headers['x-device-metadata']);
  const result = await getOrCreateDeviceFingerprint({
    fingerprintHash: hash,
    userAgent: req.get('user-agent'),
    metadata,
  });
  return result ? result.id : null;
}

/**
 * Write a single activity log entry (API request or client event).
 * Runs anomaly rules and attaches flags. Does not throw; logs errors internally.
 *
 * @param {object} params
 * @param {string} params.traceId - Request trace id (e.g. req.id).
 * @param {string} params.route - Path or route pattern.
 * @param {string} params.method - HTTP method.
 * @param {number} [params.statusCode] - HTTP status code.
 * @param {boolean} params.success - Whether the request/action succeeded.
 * @param {string} [params.errorCode] - Optional error code.
 * @param {string} [params.errorMessage] - Optional error message (avoid PII/secrets).
 * @param {string} [params.userId] - Authenticated user id if any.
 * @param {string} [params.sessionId] - Optional session id.
 * @param {string} [params.deviceFingerprintId] - From resolveDeviceFingerprintId.
 * @param {string} [params.ip] - Client IP.
 * @param {string} [params.userAgent] - User-Agent.
 * @param {string} [params.location] - Optional geo/location.
 * @param {string} [params.source] - 'api' | 'frontend'.
 * @param {string} [params.actionType] - Optional action type for filtering.
 * @param {object} [params.meta] - Optional JSON metadata (keep small).
 */
async function writeActivityLog(params) {
  const {
    traceId,
    route,
    method,
    statusCode,
    success,
    errorCode,
    errorMessage,
    userId,
    sessionId,
    deviceFingerprintId,
    ip,
    userAgent,
    location,
    source = 'api',
    actionType,
    meta,
  } = params;

  if (!traceId || !route || !method) return;

  let flags = null;
  try {
    flags = await runAnomalyRulesForActivity({
      userId,
      deviceFingerprintId,
      ip,
      route,
      success,
      actionType,
    });
  } catch (e) {
    // non-fatal
  }

  try {
    await prisma.activityLog.create({
      data: {
        trace_id: traceId,
        user_id: userId ?? null,
        session_id: sessionId ?? null,
        device_fingerprint_id: deviceFingerprintId ?? null,
        route,
        method,
        status_code: statusCode ?? null,
        success: Boolean(success),
        error_code: errorCode ?? null,
        error_message: errorMessage ? String(errorMessage).slice(0, 2000) : null,
        ip: ip ?? null,
        user_agent: userAgent ? String(userAgent).slice(0, 2000) : null,
        location: location ?? null,
        source,
        action_type: actionType ?? null,
        meta: meta && typeof meta === 'object' ? meta : undefined,
        flags: flags && flags.length ? flags : undefined,
      },
    });
  } catch (err) {
    console.error('[activityLogger] Failed to write activity log:', err.message);
  }
}

/**
 * Build activity log payload from Express req/res and optional override fields.
 * Call this in requestLogger middleware on response finish.
 *
 * @param {import('express').Request} req - Must have req.id (trace id), optionally req.user.
 * @param {import('express').Response} res - For statusCode.
 * @param {number} [durationMs] - Request duration in ms.
 * @param {{ success?: boolean, errorCode?: string, errorMessage?: string, actionType?: string, meta?: object }} [overrides]
 */
async function logRequest(req, res, durationMs, overrides = {}) {
  const traceId = req.id || req.headers['x-request-id'] || 'unknown';
  const statusCode = res.statusCode;
  const success = statusCode >= 200 && statusCode < 400;
  const route = req.originalUrl || req.url || req.path || '';
  const method = req.method || 'GET';

  let deviceFingerprintId = null;
  try {
    deviceFingerprintId = await resolveDeviceFingerprintId(req);
  } catch (_) {}

  // Prefer the geoLocation middleware's resolved country (Cloudflare CF-IPCountry
  // or geoip-lite fallback) over the legacy client-supplied `X-Geo-Location`
  // header, so we can later analyze detection accuracy and override rates.
  const detectedCountry = req.geo?.country_code || null;
  const detectionSource = req.geo?.source || null;
  const location = detectedCountry || req.headers['x-geo-location'] || null;

  const baseMeta = {};
  if (durationMs != null) baseMeta.duration_ms = durationMs;
  if (detectedCountry) {
    baseMeta.country_code = detectedCountry;
    baseMeta.detection_source = detectionSource;
  }
  const meta = Object.keys(baseMeta).length || overrides.meta
    ? { ...baseMeta, ...overrides.meta }
    : undefined;

  await writeActivityLog({
    traceId,
    route,
    method,
    statusCode,
    success: overrides.success !== undefined ? overrides.success : success,
    errorCode: overrides.errorCode,
    errorMessage: overrides.errorMessage,
    userId: req.user?.id ?? req.user?.userId ?? null,
    sessionId: req.sessionId ?? req.headers['x-session-id'] ?? null,
    deviceFingerprintId,
    ip: getClientIp(req),
    userAgent: req.get('user-agent'),
    location,
    source: 'api',
    actionType: overrides.actionType,
    meta,
  });
}

module.exports = {
  writeActivityLog,
  logRequest,
  getClientIp,
  resolveDeviceFingerprintId,
};
