/**
 * Rule-based anomaly detection for activity and audit logs.
 * Runs checks and returns an array of flag codes to attach to the log row.
 */

const prisma = require('../lib/prisma');

const FLAGS = {
  SUSPICIOUS_LOGIN_PATTERN: 'suspicious_login_pattern',
  UNUSUAL_DEVICE: 'unusual_device',
  ADMIN_ACTION_OUTSIDE_HOURS: 'admin_sensitive_action_outside_working_hours',
};

// Config: hours considered "working" for admin (UTC). 8–20 = 8am–8pm UTC.
const ADMIN_WORK_START_HOUR = 8;
const ADMIN_WORK_END_HOUR = 20;

// Failed login threshold from same IP in window (minutes).
const FAILED_LOGIN_WINDOW_MINUTES = 15;
const FAILED_LOGIN_THRESHOLD = 5;

/**
 * Check for many failed logins from same IP in a short window.
 * @param {{ ip?: string, route?: string, actionType?: string }} params
 * @returns {Promise<string[]>}
 */
async function checkSuspiciousLoginPattern({ ip, route, actionType, success }) {
  const isLoginAttempt = (route && (route.includes('/auth/login') || route.includes('/auth/otp') || route.includes('/auth'))) || actionType === 'LOGIN_FAILED';
  if (!isLoginAttempt || !ip) return [];

  const since = new Date(Date.now() - FAILED_LOGIN_WINDOW_MINUTES * 60 * 1000);
  const count = await prisma.activityLog.count({
    where: {
      ip,
      success: false,
      created_at: { gte: since },
      OR: [
        { route: { contains: 'auth', mode: 'insensitive' } },
        { action_type: 'LOGIN_FAILED' },
      ],
    },
  });
  const total = count + (success === false && isLoginAttempt ? 1 : 0);
  return total >= FAILED_LOGIN_THRESHOLD ? [FLAGS.SUSPICIOUS_LOGIN_PATTERN] : [];
}

/**
 * Check if this is first time user is seen from this device (unusual device).
 * @param {{ userId?: string, deviceFingerprintId?: string }} params
 * @returns {Promise<string[]>}
 */
async function checkUnusualDevice({ userId, deviceFingerprintId }) {
  if (!userId || !deviceFingerprintId) return [];

  const linked = await prisma.userDevice.findFirst({
    where: { user_id: userId, device_fingerprint_id: deviceFingerprintId },
  });
  return !linked ? [FLAGS.UNUSUAL_DEVICE] : [];
}

/**
 * Check if admin action is outside "working hours" (simple UTC window).
 * @param {{ actionType?: string, route?: string }} params - and we'd need to know if actor is admin; route under /admin is a proxy.
 * @returns {string[]}
 */
function checkAdminOutsideHours({ actionType, route }) {
  const isAdminRoute = route && route.includes('/admin') && route !== '/admin/register';
  if (!isAdminRoute) return [];

  const hour = new Date().getUTCHours();
  if (hour >= ADMIN_WORK_START_HOUR && hour < ADMIN_WORK_END_HOUR) return [];
  return [FLAGS.ADMIN_ACTION_OUTSIDE_HOURS];
}

/**
 * Run all anomaly rules for an activity log entry. Returns array of flag codes.
 * @param {object} params - userId, deviceFingerprintId, ip, route, success, actionType
 * @returns {Promise<string[]>}
 */
async function runAnomalyRulesForActivity(params) {
  const flags = [];
  try {
    const loginFlags = await checkSuspiciousLoginPattern(params);
    flags.push(...loginFlags);

    // Only run UNUSUAL_DEVICE check for login-like events, not every request.
    const route = params.route || '';
    const actionType = params.actionType || '';
    const isLoginLike =
      (route.includes('/auth/login') ||
        route.includes('/auth/otp') ||
        route.includes('/auth')) ||
      actionType === 'LOGIN_FAILED' ||
      actionType === 'LOGIN_SUCCESS';

    if (isLoginLike) {
      const deviceFlags = await checkUnusualDevice(params);
      flags.push(...deviceFlags);
    }

    const hourFlags = checkAdminOutsideHours(params);
    flags.push(...hourFlags);
  } catch (e) {
    // non-fatal
  }
  return [...new Set(flags)];
}

/**
 * Run anomaly rules for an audit log entry (e.g. admin action outside hours).
 * @param {{ actionType: string, actorAdminId?: string, route?: string }} params
 * @returns {Promise<string[]>}
 */
async function runAnomalyRulesForAudit(params) {
  const flags = [];
  try {
    flags.push(...checkAdminOutsideHours(params));
  } catch (e) {}
  return [...new Set(flags)];
}

module.exports = {
  runAnomalyRulesForActivity,
  runAnomalyRulesForAudit,
  FLAGS,
};
