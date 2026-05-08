const prisma = require('../lib/prisma');
const { writeAuditLog } = require('../logging/auditLogger');
const { emitEvent } = require('../lib/realtime');
const adminNotificationService = require('../services/adminNotificationService');

// Create support issue for authenticated user
exports.createIssue = async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const userEmail = req.user?.email || null;
    const { email, subject, message, category, metadata } = req.body;

    const finalEmail = (userEmail || email || '').trim();

    if (!finalEmail || !subject || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Email, subject, and message are required'
      });
    }

    const issue = await prisma.userIssue.create({
      data: {
        user_id: userId,
        email: finalEmail,
        subject: String(subject).trim(),
        message: String(message).trim(),
        category: category ? String(category).trim() : null,
        status: 'NEW',
        metadata: metadata && typeof metadata === 'object' ? metadata : undefined
      }
    });

    adminNotificationService.create({
      severity: 'info',
      category: 'support',
      title: 'New support request',
      message: String(subject).trim(),
      actionUrl: `/admin/support/issues/${issue.id}`,
      metadata: { issueId: issue.id, email: finalEmail },
    }).catch((err) => console.error('[Support] Admin notification error:', err));

    if (userId) {
      writeAuditLog({
        actionType: 'USER_ISSUE_CREATED',
        actorUserId: userId,
        resourceType: 'user_issue',
        resourceId: issue.id,
        req,
      }).catch(() => {});
    }

    res.status(201).json({
      status: 'success',
      message: 'Issue submitted successfully',
      data: {
        issue: {
          id: issue.id,
          subject: issue.subject,
          status: issue.status,
          createdAt: issue.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Create support issue error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error submitting issue'
    });
  }
};

// Create support issue for anonymous user
exports.createAnonymousIssue = async (req, res) => {
  try {
    const { email, subject, message, category, metadata } = req.body;

    if (!email || !subject || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Email, subject, and message are required'
      });
    }

    const issue = await prisma.userIssue.create({
      data: {
        user_id: null,
        email: String(email).trim(),
        subject: String(subject).trim(),
        message: String(message).trim(),
        category: category ? String(category).trim() : null,
        status: 'NEW',
        metadata: metadata && typeof metadata === 'object' ? metadata : undefined
      }
    });

    adminNotificationService.create({
      severity: 'info',
      category: 'support',
      title: 'New support request (anonymous)',
      message: String(subject).trim(),
      actionUrl: `/admin/support/issues/${issue.id}`,
      metadata: { issueId: issue.id, email: String(email).trim() },
    }).catch((err) => console.error('[Support] Admin notification error:', err));

    res.status(201).json({
      status: 'success',
      message: 'Issue submitted successfully',
      data: {
        issue: {
          id: issue.id,
          subject: issue.subject,
          status: issue.status,
          createdAt: issue.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Create anonymous support issue error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error submitting issue'
    });
  }
};

// List issues created by the current user
exports.getMyIssues = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 10, 50);
    const offset = (pageNum - 1) * limitNum;

    const [issues, total] = await Promise.all([
      prisma.userIssue.findMany({
        where: { user_id: userId },
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip: offset
      }),
      prisma.userIssue.count({
        where: { user_id: userId }
      })
    ]);

    res.json({
      status: 'success',
      data: {
        issues,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          hasNext: pageNum * limitNum < total,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('Get my issues error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error fetching issues'
    });
  }
};

// Admin: list support issues with filters
exports.adminListIssues = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, category, email, q } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    const where = {};

    if (status) {
      where.status = String(status).toUpperCase();
    }
    if (category) {
      where.category = { equals: String(category), mode: 'insensitive' };
    }
    if (email) {
      where.email = { contains: String(email), mode: 'insensitive' };
    }
    if (q) {
      const query = String(q).trim();
      where.OR = [
        { subject: { contains: query, mode: 'insensitive' } },
        { message: { contains: query, mode: 'insensitive' } }
      ];
    }

    const [issues, total] = await Promise.all([
      prisma.userIssue.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip: offset,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true
            }
          }
        }
      }),
      prisma.userIssue.count({ where })
    ]);

    res.json({
      status: 'success',
      data: {
        issues,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          hasNext: pageNum * limitNum < total,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('Admin list issues error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error fetching issues'
    });
  }
};

// Admin: get single issue
exports.adminGetIssueById = async (req, res) => {
  try {
    const { id } = req.params;

    const issue = await prisma.userIssue.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true
          }
        }
      }
    });

    if (!issue) {
      return res.status(404).json({
        status: 'error',
        message: 'Issue not found'
      });
    }

    res.json({
      status: 'success',
      data: { issue }
    });
  } catch (error) {
    console.error('Admin get issue error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error fetching issue'
    });
  }
};

// Admin: update issue status, metadata, or admin response; notify user when applicable
exports.adminUpdateIssue = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, category, metadata, adminMessage, response } = req.body;
    const adminResponseText = adminMessage || response || null;

    const data = {};
    if (status) data.status = String(status).toUpperCase();
    if (category) data.category = String(category).trim();
    if (metadata && typeof metadata === 'object') data.metadata = metadata;
    if (adminResponseText) data.admin_response = String(adminResponseText).trim();

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No valid fields provided for update'
      });
    }

    const issue = await prisma.userIssue.update({
      where: { id },
      data,
      include: {
        user: {
          select: { id: true, username: true }
        }
      }
    });

    // If issue has a user_id, create in-app notification for the user
    if (issue.user_id && issue.user?.username) {
      let message = 'Your support request was updated.';
      if (data.status) message += ` Status updated to ${data.status}.`;
      if (adminResponseText) message += ` Response: ${adminResponseText}`;

      const notification = await prisma.notification.create({
        data: {
          userID: issue.user.username,
          message,
          type: 'support_issue_update',
          isRead: false
        }
      });

      emitEvent('notification:created', {
        userId: issue.user.id,
        userID: issue.user.username,
        notification: {
          id: notification.id,
          type: notification.type,
          message: notification.message,
          isRead: notification.isRead,
          createdAt: notification.createdAt
        }
      });
    }

    writeAuditLog({
      actionType: 'USER_ISSUE_UPDATED',
      actorAdminId: req.user.id,
      resourceType: 'user_issue',
      resourceId: id,
      details: data,
      req,
    }).catch(() => {});

    res.json({
      status: 'success',
      message: 'Issue updated successfully',
      data: { issue }
    });
  } catch (error) {
    console.error('Admin update issue error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error updating issue'
    });
  }
};

