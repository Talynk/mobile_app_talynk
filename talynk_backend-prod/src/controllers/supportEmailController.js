const prisma = require('../lib/prisma');

function getTimeBucketStart(timeBucket) {
  if (!timeBucket) return null;
  const now = Date.now();
  const buckets = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const ms = buckets[timeBucket];
  if (!ms) return null;
  return new Date(now - ms);
}

exports.listEmails = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      isRead,
      category,
      timeBucket,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (isRead === 'true') where.isRead = true;
    if (isRead === 'false') where.isRead = false;
    if (category) where.category = category;

    const start = getTimeBucketStart(timeBucket);
    if (start) where.receivedAt = { gte: start };

    const [items, total] = await Promise.all([
      prisma.supportEmail.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip,
        take: limitNum,
        select: {
          id: true,
          from: true,
          to: true,
          subject: true,
          isRead: true,
          category: true,
          receivedAt: true,
        },
      }),
      prisma.supportEmail.count({ where }),
    ]);

    res.json({
      status: 'success',
      data: {
        items,
        total,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error('[SupportEmail] listEmails error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to list support emails',
    });
  }
};

exports.getEmailById = async (req, res) => {
  try {
    const { id } = req.params;
    const email = await prisma.supportEmail.findUnique({
      where: { id },
    });
    if (!email) {
      return res.status(404).json({
        status: 'error',
        message: 'Email not found',
      });
    }
    res.json({
      status: 'success',
      data: email,
    });
  } catch (error) {
    console.error('[SupportEmail] getEmailById error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get email',
    });
  }
};

exports.markRead = async (req, res) => {
  try {
    const { id } = req.params;
    const email = await prisma.supportEmail.update({
      where: { id },
      data: { isRead: true },
    });
    res.json({
      status: 'success',
      data: email,
    });
  } catch (error) {
    console.error('[SupportEmail] markRead error:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Email not found',
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Failed to mark email as read',
    });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await prisma.supportEmail.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });
    res.json({
      status: 'success',
      data: { ok: true },
    });
  } catch (error) {
    console.error('[SupportEmail] markAllRead error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to mark all emails as read',
    });
  }
};

exports.getStats = async (req, res) => {
  try {
    const { timeBucket } = req.query;
    const where = {};
    const start = getTimeBucketStart(timeBucket);
    if (start) where.receivedAt = { gte: start };

    const [total, unread, byCategory] = await Promise.all([
      prisma.supportEmail.count({ where }),
      prisma.supportEmail.count({ where: { ...where, isRead: false } }),
      prisma.supportEmail.groupBy({
        by: ['category'],
        where,
        _count: { id: true },
      }),
    ]);

    res.json({
      status: 'success',
      data: {
        total,
        unread,
        byCategory: Object.fromEntries(
          byCategory.map((c) => [c.category || 'uncategorized', c._count.id]),
        ),
      },
    });
  } catch (error) {
    console.error('[SupportEmail] getStats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get support email stats',
    });
  }
};

