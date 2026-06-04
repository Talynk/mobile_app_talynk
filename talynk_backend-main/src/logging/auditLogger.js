/**
 * Audit logger for security-sensitive actions (admin actions, auth events, moderation, etc.).
 * Writes to audit_logs with actor, action_type, resource, and optional details.
 */

const prisma = require('../lib/prisma');
const { runAnomalyRulesForAudit } = require('./logAnalyzer');

/**
 * Resolve device_fingerprint_id from request (same as activityLogger).
 * @param {import('express').Request} [req]
 * @returns {Promise<string|null>}
 */
async function resolveDeviceFingerprintIdFromRequest(req) {
  if (!req || !req.headers) return null;
  const hash = req.headers['x-device-fingerprint'];
  if (!hash) return null;
  const { getOrCreateDeviceFingerprint, parseDeviceMetadata } = require('./deviceFingerprintService');
  const metadata = parseDeviceMetadata(req.headers['x-device-metadata']);
  const result = await getOrCreateDeviceFingerprint({
    fingerprintHash: hash,
    userAgent: req.get('user-agent'),
    metadata,
  });
  return result ? result.id : null;
}

/**
 * Get client IP from request.
 * @param {import('express').Request} [req]
 * @returns {string|undefined}
 */
function getClientIp(req) {
  if (!req) return undefined;
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0];
    return first ? first.trim() : undefined;
  }
  return req.ip || req.socket?.remoteAddress;
}

/**
 * Write an audit log entry. Does not throw; logs errors internally.
 *
 * @param {object} params
 * @param {string} params.actionType - e.g. ADMIN_SUSPEND_USER, ADMIN_DELETE_POST, LOGIN_SUCCESS, LOGIN_FAILED.
 * @param {string} [params.resourceType] - user, post, challenge, ad, etc.
 * @param {string} [params.resourceId] - ID of the resource.
 * @param {string} [params.actorAdminId] - Admin who performed the action.
 * @param {string} [params.actorUserId] - User who performed the action (e.g. login).
 * @param {string} [params.ip]
 * @param {string} [params.deviceFingerprintId]
 * @param {object} [params.details] - JSON details (reason, recipientCount, old/new values, etc.).
 * @param {import('express').Request} [params.req] - If provided, ip and deviceFingerprintId are derived from it.
 */
async function writeAuditLog(params) {
  const {
    actionType,
    resourceType,
    resourceId,
    actorAdminId,
    actorUserId,
    ip,
    deviceFingerprintId,
    details,
    req,
  } = params;

  if (!actionType) return;

  let resolvedIp = ip;
  let resolvedDeviceId = deviceFingerprintId;
  if (req) {
    resolvedIp = resolvedIp ?? getClientIp(req);
    if (!resolvedDeviceId) {
      try {
        resolvedDeviceId = await resolveDeviceFingerprintIdFromRequest(req);
      } catch (_) {}
    }
  }

  let flags = null;
  try {
    flags = await runAnomalyRulesForAudit({
      actionType,
      actorAdminId,
      route: req?.originalUrl || req?.path,
    });
  } catch (_) {}

  // Enrich `details` with the geoLocation middleware's resolved country so
  // security reviewers can correlate sensitive actions (logins, deletions,
  // admin moderation) with the visitor's region without joining tables.
  let mergedDetails = null;
  if (details && typeof details === 'object') {
    mergedDetails = { ...details };
  }
  if (req?.geo?.country_code) {
    mergedDetails = mergedDetails || {};
    if (mergedDetails.country_code === undefined) {
      mergedDetails.country_code = req.geo.country_code;
    }
    if (mergedDetails.detection_source === undefined && req.geo.source) {
      mergedDetails.detection_source = req.geo.source;
    }
  }

  try {
    await prisma.auditLog.create({
      data: {
        action_type: actionType,
        resource_type: resourceType ?? null,
        resource_id: resourceId ?? null,
        actor_admin_id: actorAdminId ?? null,
        actor_user_id: actorUserId ?? null,
        ip: resolvedIp ?? null,
        device_fingerprint_id: resolvedDeviceId ?? null,
        details: mergedDetails && Object.keys(mergedDetails).length ? mergedDetails : undefined,
        flags: flags && flags.length ? flags : undefined,
      },
    });
  } catch (err) {
    console.error('[auditLogger] Failed to write audit log:', err.message);
  }
}

module.exports = {
  writeAuditLog,
  getClientIp,
  resolveDeviceFingerprintIdFromRequest,
};
