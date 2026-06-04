/**
 * Admin endpoints for viewing activity logs, audit logs, and device-centric activity.
 * All require admin authentication.
 */

const prisma = require('../lib/prisma');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePageLimit(query) {
  const page = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}

function parseDateRange(dateFrom, dateTo) {
  const range = {};
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (!isNaN(d.getTime())) range.gte = d;
  }
  if (dateTo) {
    const d = new Date(dateTo);
    if (!isNaN(d.getTime())) range.lte = d;
  }
  return Object.keys(range).length ? range : undefined;
}

/**
 * GET /api/admin/logs/activity
 * Query: page, limit, dateFrom, dateTo, userId, route, method, statusCode, success, source, actionType, ip, deviceFingerprint (hash)
 */
async function getActivityLogs(req, res) {
  try {
    const { page, limit, skip } = parsePageLimit(req.query);
    const { dateFrom, dateTo, userId, route, method, statusCode, success, source, actionType, ip } = req.query;

    const where = {};

    const createdAt = parseDateRange(dateFrom, dateTo);
    if (createdAt) where.created_at = createdAt;
    if (userId) where.user_id = userId;
    if (route) where.route = { contains: route, mode: 'insensitive' };
    if (method) where.method = method.toUpperCase();
    if (statusCode) where.status_code = parseInt(statusCode, 10);
    if (success !== undefined && success !== '') {
      where.success = success === 'true' || success === true;
    }
    if (source) where.source = source;
    if (actionType) where.action_type = actionType;
    if (ip) where.ip = { contains: ip, mode: 'insensitive' };

    if (req.query.deviceFingerprint) {
      const dev = await prisma.deviceFingerprint.findFirst({
        where: { fingerprint_hash: { contains: req.query.deviceFingerprint, mode: 'insensitive' } },
        select: { id: true },
      });
      if (dev) where.device_fingerprint_id = dev.id;
    }

    const [items, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          trace_id: true,
          user_id: true,
          device_fingerprint_id: true,
          route: true,
          method: true,
          status_code: true,
          success: true,
          error_code: true,
          error_message: true,
          ip: true,
          user_agent: true,
          source: true,
          action_type: true,
          meta: true,
          flags: true,
          created_at: true,
        },
      }),
      prisma.activityLog.count({ where }),
    ]);

    res.json({
      status: 'success',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('getActivityLogs error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activity logs',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * GET /api/admin/logs/activity/:id
 */
async function getActivityLogById(req, res) {
  try {
    const { id } = req.params;
    const log = await prisma.activityLog.findUnique({
      where: { id },
      include: {
        device_fingerprint: {
          select: { id: true, fingerprint_hash: true, user_agent: true, last_seen_at: true },
        },
      },
    });
    if (!log) {
      return res.status(404).json({ status: 'error', message: 'Activity log not found' });
    }
    res.json({ status: 'success', data: log });
  } catch (err) {
    console.error('getActivityLogById error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch activity log',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * GET /api/admin/logs/traces/:traceId
 * Returns all activity logs with this trace_id (and optionally same device).
 */
async function getActivityLogsByTraceId(req, res) {
  try {
    const { traceId } = req.params;
    const items = await prisma.activityLog.findMany({
      where: { trace_id: traceId },
      orderBy: { created_at: 'asc' },
      include: {
        device_fingerprint: {
          select: { id: true, fingerprint_hash: true, user_agent: true },
        },
      },
    });
    res.json({ status: 'success', data: { traceId, items } });
  } catch (err) {
    console.error('getActivityLogsByTraceId error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch trace logs',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * GET /api/admin/logs/audit
 * Query: page, limit, dateFrom, dateTo, actionType, resourceType, resourceId, actorAdminId, actorUserId
 */
async function getAuditLogs(req, res) {
  try {
    const { page, limit, skip } = parsePageLimit(req.query);
    const { dateFrom, dateTo, actionType, resourceType, resourceId, actorAdminId, actorUserId } = req.query;

    const where = {};
    const createdAt = parseDateRange(dateFrom, dateTo);
    if (createdAt) where.created_at = createdAt;
    if (actionType) where.action_type = actionType;
    if (resourceType) where.resource_type = resourceType;
    if (resourceId) where.resource_id = resourceId;
    if (actorAdminId) where.actor_admin_id = actorAdminId;
    if (actorUserId) where.actor_user_id = actorUserId;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          device_fingerprint: {
            select: { id: true, fingerprint_hash: true, user_agent: true },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      status: 'success',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('getAuditLogs error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch audit logs',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * GET /api/admin/devices
 * Query: page, limit, fingerprint (hash substring), userId (user who used device), ip (from activity)
 */
async function getDevices(req, res) {
  try {
    const { page, limit, skip } = parsePageLimit(req.query);
    const { fingerprint, userId } = req.query;

    const where = {};
    if (fingerprint) {
      where.fingerprint_hash = { contains: fingerprint, mode: 'insensitive' };
    }
    if (userId) {
      where.user_devices = { some: { user_id: userId } };
    }

    const [items, total] = await Promise.all([
      prisma.deviceFingerprint.findMany({
        where,
        orderBy: { last_seen_at: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          fingerprint_hash: true,
          first_seen_at: true,
          last_seen_at: true,
          user_agent: true,
          os: true,
          browser: true,
          locale: true,
          _count: { select: { activity_logs: true, user_devices: true } },
        },
      }),
      prisma.deviceFingerprint.count({ where }),
    ]);

    res.json({
      status: 'success',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('getDevices error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch devices',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * GET /api/admin/devices/:deviceFingerprintId/activity
 */
async function getDeviceActivity(req, res) {
  try {
    const { deviceFingerprintId } = req.params;
    const { page, limit, skip } = parsePageLimit(req.query);

    const device = await prisma.deviceFingerprint.findUnique({
      where: { id: deviceFingerprintId },
      select: { id: true, fingerprint_hash: true, user_agent: true, last_seen_at: true },
    });
    if (!device) {
      return res.status(404).json({ status: 'error', message: 'Device not found' });
    }

    const [items, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: { device_fingerprint_id: deviceFingerprintId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          trace_id: true,
          user_id: true,
          route: true,
          method: true,
          status_code: true,
          success: true,
          ip: true,
          source: true,
          action_type: true,
          flags: true,
          created_at: true,
        },
      }),
      prisma.activityLog.count({ where: { device_fingerprint_id: deviceFingerprintId } }),
    ]);

    res.json({
      status: 'success',
      data: {
        device,
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('getDeviceActivity error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch device activity',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

module.exports = {
  getActivityLogs,
  getActivityLogById,
  getActivityLogsByTraceId,
  getAuditLogs,
  getDevices,
  getDeviceActivity,
};
