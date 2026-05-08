/**
 * Logs controller: client event ingestion and (admin) log viewing.
 * Activity/audit list endpoints are under admin (see adminController or dedicated admin logs controller).
 */

const { writeActivityLog } = require('../logging/activityLogger');

/**
 * POST /api/logs/client-events
 * Body: { eventType: string, page?: string, action?: string, meta?: object }
 * Headers: X-Device-Fingerprint (optional), X-Request-Id (optional as traceId)
 * Writes to activity_logs with source='frontend'. Fire-and-forget; does not block.
 */
async function postClientEvent(req, res) {
  try {
    const { eventType, page, action, meta } = req.body || {};
    if (!eventType || typeof eventType !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'eventType is required and must be a string',
      });
    }

    const traceId = req.id || req.headers['x-request-id'] || `fe-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    let deviceFingerprintId = null;
    try {
      const { resolveDeviceFingerprintId } = require('../logging/activityLogger');
      deviceFingerprintId = await resolveDeviceFingerprintId(req);
    } catch (_) {}

    const route = page ? `[client] ${page}` : '[client]';
    const payload = {
      traceId,
      route,
      method: 'POST',
      statusCode: 200,
      success: true,
      userId: req.user?.id ?? req.user?.userId ?? null,
      sessionId: req.headers['x-session-id'] ?? null,
      deviceFingerprintId,
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
      userAgent: req.get('user-agent'),
      source: 'frontend',
      actionType: eventType,
      meta: {
        ...(page && { page }),
        ...(action && { action }),
        ...(meta && typeof meta === 'object' && meta),
      },
    };

    writeActivityLog(payload).catch(() => {});
    res.status(202).json({ status: 'success', message: 'Event received' });
  } catch (err) {
    console.error('[logsController] postClientEvent error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to record event' });
  }
}

module.exports = {
  postClientEvent,
};
