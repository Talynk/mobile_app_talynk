const prisma = require('../lib/prisma');
const { emitEvent } = require('../lib/realtime');

const CONSOLIDATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const TIME_BUCKETS = {
  '1h': () => new Date(Date.now() - 60 * 60 * 1000),
  '24h': () => new Date(Date.now() - 24 * 60 * 60 * 1000),
  '7d': () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  '30d': () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
};

/**
 * Get start date for a time bucket (for filtering createdAt).
 * @param {string} timeBucket - '1h' | '24h' | '7d' | '30d'
 * @returns {Date | null}
 */
function getTimeBucketStart(timeBucket) {
  if (!timeBucket || !TIME_BUCKETS[timeBucket]) return null;
  return TIME_BUCKETS[timeBucket]();
}

/**
 * Build minimal payload for real-time emission (lightweight).
 * @param {object} notification - AdminNotification record
 */
function toEmitPayload(notification) {
  return {
    id: notification.id,
    severity: notification.severity,
    category: notification.category,
    title: notification.title,
    message: notification.message,
    actionUrl: notification.actionUrl ?? undefined,
    consolidatedCount: notification.consolidatedCount ?? 1,
    createdAt: notification.createdAt?.toISOString?.() ?? notification.createdAt,
    ...(notification.metadata && Object.keys(notification.metadata).length > 0 ? { metadata: notification.metadata } : {}),
  };
}

/**
 * Create an admin notification, optionally consolidating with a recent one with the same category + consolidatedKey.
 * Emits 'admin:notification' for real-time delivery.
 * @param {object} params
 * @param {string} params.severity - info | warning | critical | action_required
 * @param {string} params.category - appeal | report | support | security | queue | system
 * @param {string} params.title
 * @param {string} params.message
 * @param {string} [params.actionUrl]
 * @param {object} [params.metadata]
 * @param {string} [params.consolidatedKey] - e.g. 'report:postId', 'appeal:appealId'
 * @returns {Promise<object>} Created or updated AdminNotification
 */
async function create(params) {
  const { severity, category, title, message, actionUrl, metadata, consolidatedKey } = params;

  let notification;

  if (consolidatedKey) {
    const since = new Date(Date.now() - CONSOLIDATION_WINDOW_MS);
    const existing = await prisma.adminNotification.findFirst({
      where: {
        category,
        consolidatedKey,
        createdAt: { gte: since },
        readAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const newCount = (existing.consolidatedCount ?? 1) + 1;
      const consolidatedMessage = newCount > 1 ? `${newCount} - ${message}` : message;

      notification = await prisma.adminNotification.update({
        where: { id: existing.id },
        data: {
          consolidatedCount: newCount,
          message: consolidatedMessage,
          severity,
          ...(actionUrl && { actionUrl }),
          ...(metadata && { metadata: { ...(existing.metadata || {}), ...metadata } }),
        },
      });
    } else {
      notification = await prisma.adminNotification.create({
        data: {
          severity,
          category,
          title,
          message,
          actionUrl: actionUrl ?? null,
          metadata: metadata ?? undefined,
          consolidatedKey,
          consolidatedCount: 1,
        },
      });
    }
  } else {
    notification = await prisma.adminNotification.create({
      data: {
        severity,
        category,
        title,
        message,
        actionUrl: actionUrl ?? null,
        metadata: metadata ?? undefined,
        consolidatedCount: 1,
      },
    });
  }

  const payload = toEmitPayload(notification);
  emitEvent('admin:notification', payload);

  return notification;
}

/**
 * List admin notifications with optional filters and pagination.
 * @param {object} opts
 * @param {string} [opts.severity]
 * @param {string} [opts.category]
 * @param {string} [opts.timeBucket] - '1h' | '24h' | '7d' | '30d'
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 * @param {boolean} [opts.unreadOnly]
 */
async function list(opts = {}) {
  const { severity, category, timeBucket, page = 1, limit = 20, unreadOnly } = opts;
  const where = {};

  if (severity) where.severity = severity;
  if (category) where.category = category;
  if (unreadOnly) where.readAt = null;

  const start = getTimeBucketStart(timeBucket);
  if (start) where.createdAt = { gte: start };

  const [items, total] = await Promise.all([
    prisma.adminNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: Math.min(limit, 100),
    }),
    prisma.adminNotification.count({ where }),
  ]);

  return { items, total, page, limit };
}

/**
 * Get stats: total, unread, bySeverity, byCategory, and optional trend (last 7 days).
 * @param {object} opts
 * @param {string} [opts.timeBucket] - optional scope for total/bySeverity/byCategory
 */
async function getStats(opts = {}) {
  const { timeBucket } = opts;
  const where = {};
  const start = getTimeBucketStart(timeBucket);
  if (start) where.createdAt = { gte: start };

  const [total, unreadCount, bySeverity, byCategory] = await Promise.all([
    prisma.adminNotification.count({ where }),
    prisma.adminNotification.count({ where: { ...where, readAt: null } }),
    prisma.adminNotification.groupBy({
      by: ['severity'],
      where,
      _count: { id: true },
    }),
    prisma.adminNotification.groupBy({
      by: ['category'],
      where,
      _count: { id: true },
    }),
  ]);

  const trendStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const trendRaw = await prisma.adminNotification.findMany({
    where: { createdAt: { gte: trendStart } },
    select: { createdAt: true, severity: true },
  });

  const byDay = {};
  trendRaw.forEach((n) => {
    const day = n.createdAt.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { total: 0, bySeverity: {} };
    byDay[day].total += 1;
    byDay[day].bySeverity[n.severity] = (byDay[day].bySeverity[n.severity] || 0) + 1;
  });
  const trend = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  return {
    total,
    unread: unreadCount,
    bySeverity: Object.fromEntries(bySeverity.map((s) => [s.severity, s._count.id])),
    byCategory: Object.fromEntries(byCategory.map((c) => [c.category, c._count.id])),
    trend,
  };
}

/**
 * Mark a single notification as read.
 * @param {string} id - AdminNotification id (UUID)
 */
async function markRead(id) {
  return prisma.adminNotification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

/**
 * Mark all notifications as read.
 */
async function markAllRead() {
  await prisma.adminNotification.updateMany({
    where: { readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

/**
 * Get a single notification by id.
 * @param {string} id - AdminNotification id (UUID)
 */
async function getById(id) {
  return prisma.adminNotification.findUnique({
    where: { id },
  });
}

module.exports = {
  create,
  list,
  getStats,
  markRead,
  markAllRead,
  getById,
  getTimeBucketStart,
  TIME_BUCKETS,
  toEmitPayload,
};
