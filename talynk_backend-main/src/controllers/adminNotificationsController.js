const adminNotificationService = require('../services/adminNotificationService');

/**
 * GET /api/admin/notifications
 * Query: severity, category, timeBucket (1h|24h|7d|30d), page, limit, unreadOnly
 */
async function list(req, res) {
  try {
    const { severity, category, timeBucket, page, limit, unreadOnly } = req.query;
    const result = await adminNotificationService.list({
      severity: severity || undefined,
      category: category || undefined,
      timeBucket: timeBucket || undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      unreadOnly: unreadOnly === 'true' || unreadOnly === true,
    });
    return res.json(result);
  } catch (error) {
    console.error('[adminNotifications] list error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to list admin notifications' });
  }
}

/**
 * GET /api/admin/notifications/stats
 * Query: timeBucket (optional)
 */
async function getStats(req, res) {
  try {
    const { timeBucket } = req.query;
    const stats = await adminNotificationService.getStats({
      timeBucket: timeBucket || undefined,
    });
    return res.json(stats);
  } catch (error) {
    console.error('[adminNotifications] getStats error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to get notification stats' });
  }
}

/**
 * PATCH /api/admin/notifications/read-all
 */
async function markAllRead(req, res) {
  try {
    await adminNotificationService.markAllRead();
    return res.json({ ok: true });
  } catch (error) {
    console.error('[adminNotifications] markAllRead error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to mark all as read' });
  }
}

/**
 * GET /api/admin/notifications/:id
 */
async function getById(req, res) {
  try {
    const { id } = req.params;
    const notification = await adminNotificationService.getById(id);
    if (!notification) {
      return res.status(404).json({ status: 'error', message: 'Notification not found' });
    }
    return res.json(notification);
  } catch (error) {
    console.error('[adminNotifications] getById error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to get notification' });
  }
}

/**
 * PATCH /api/admin/notifications/:id/read
 */
async function markRead(req, res) {
  try {
    const { id } = req.params;
    const notification = await adminNotificationService.markRead(id);
    return res.json(notification);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ status: 'error', message: 'Notification not found' });
    }
    console.error('[adminNotifications] markRead error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to mark as read' });
  }
}

module.exports = {
  list,
  getStats,
  markAllRead,
  getById,
  markRead,
};
