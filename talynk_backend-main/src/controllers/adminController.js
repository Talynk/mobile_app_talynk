const axios = require('axios');
const prisma = require('../lib/prisma');
const { withVideoPlaybackUrl } = require('../utils/postVideoUtils');
const { writeAuditLog } = require('../logging/auditLogger');
const adminNotificationService = require('../services/adminNotificationService');
const { clearCacheByPattern } = require('../utils/cache');
const { R2_PUBLIC_DOMAIN } = require('../services/r2Storage');
const { invalidatePostCaches } = require('../utils/postCacheInvalidation');
const {
    getPostReportSuspendThreshold,
    setPostReportSuspendThreshold
} = require('../utils/moderationSettings');

/**
 * Get Admin ID from user (handles both Admin records and Users with admin role)
 * @param {string} userId - User/Admin ID from JWT token
 * @param {string} userRole - User role from JWT token
 * @returns {Promise<string|null>} Admin ID or null if not found
 */
const getAdminId = async (userId, userRole) => {
    if (userRole !== 'admin') {
        return null;
    }

    // Check if it's an Admin record
    const admin = await prisma.admin.findUnique({
        where: { id: userId }
    });
    
    if (admin) {
        return admin.id;
    }
    
    // User with admin role - find or create Admin record
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, email: true }
    });
    
    if (!user) {
        return null;
    }
    
    // Try to find Admin by username or email
    let adminRecord = await prisma.admin.findFirst({
        where: {
            OR: [
                { username: user.username },
                { email: user.email }
            ]
        }
    });
    
    // If no Admin record exists, create one
    if (!adminRecord) {
        adminRecord = await prisma.admin.create({
            data: {
                username: user.username || `admin_${userId.substring(0, 8)}`,
                email: user.email || `admin_${userId}@talynk.com`,
                password: '', // Password not needed for existing user
                status: 'active'
            }
        });
    }
    
    return adminRecord.id;
};

/** Parse time frame for activity/engagement queries. Returns { startDate, interval } for DB truncation. */
const parseTimeFrame = (frame) => {
    const now = new Date();
    const validFrames = ['1h', '12h', '24h', '7d', '30d'];
    const f = (frame || '24h').toLowerCase();
    const frameHours = { '1h': 1, '12h': 12, '24h': 24, '7d': 168, '30d': 720 };
    const hours = frameHours[f] != null ? frameHours[f] : 24;
    const startDate = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const interval = hours <= 1 ? 'hour' : hours <= 24 ? 'hour' : 'day';
    return { startDate, interval, hours };
};

const bcrypt = require('bcryptjs');
const { loggers } = require('../middleware/extendedLogger');
const { emitEvent } = require('../lib/realtime');
const challengeController = require('./challengeController');
const { buildUserSearchWhere, parsePagination, normalizeQuery } = require('../utils/userSearch');
const { buildPostSearchWhere, buildChallengeSearchWhere } = require('../utils/adminSearch');

// Register a new admin
exports.registerAdmin = async (req, res) => {
    try {
        const { email, username, password } = req.body;

        // Validate required fields
        if (!email || !username || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Email, username, and password are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid email format'
            });
        }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({
                status: 'error',
                message: 'Password must be at least 6 characters long'
            });
        }

        // Check if admin already exists
        const existingAdmin = await prisma.admin.findFirst({
            where: {
                OR: [
                    { email: email.toLowerCase() },
                    { username: username.toLowerCase() }
                ]
            }
        });

        if (existingAdmin) {
            return res.status(409).json({
                status: 'error',
                message: 'Admin with this email or username already exists'
            });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create admin
        const admin = await prisma.admin.create({
            data: {
                email: email.toLowerCase(),
                username: username.toLowerCase(),
                password: hashedPassword,
                status: 'active'
            },
            select: {
                id: true,
                email: true,
                username: true,
                status: true,
                createdAt: true
            }
        });

        writeAuditLog({
            actionType: 'ADMIN_REGISTER',
            resourceType: 'admin',
            resourceId: admin.id,
            details: { username: admin.username, email: admin.email },
            req,
        }).catch(() => {});

        res.status(201).json({
            status: 'success',
            message: 'Admin registered successfully',
            data: {
                admin
            }
        });

    } catch (error) {
        console.error('Admin registration error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error registering admin'
        });
    }
};

// Get sessions for a specific user (admin view)
exports.getUserSessions = async (req, res) => {
    try {
        const targetUserId = req.params.userId;

        if (!targetUserId) {
            return res.status(400).json({
                status: 'error',
                message: 'User ID is required'
            });
        }

        const sessions = await prisma.userSession.findMany({
            where: {
                user_id: targetUserId
            },
            orderBy: {
                created_at: 'desc'
            },
            select: {
                id: true,
                user_id: true,
                device_fingerprint_id: true,
                user_agent: true,
                ip_address: true,
                created_at: true,
                last_active_at: true,
                revoked_at: true,
                revoked_by: true
            }
        });

        res.json({
            status: 'success',
            data: {
                sessions
            }
        });
    } catch (error) {
        console.error('Admin getUserSessions error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching user sessions'
        });
    }
};

// Revoke a specific session for a user (admin action)
exports.revokeUserSession = async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const { sessionId } = req.params;
        const adminId = await getAdminId(req.user.id, req.user.role);

        if (!targetUserId || !sessionId) {
            return res.status(400).json({
                status: 'error',
                message: 'User ID and session ID are required'
            });
        }

        const result = await prisma.userSession.updateMany({
            where: {
                id: String(sessionId),
                user_id: targetUserId,
                revoked_at: null
            },
            data: {
                revoked_at: new Date(),
                revoked_by: adminId || req.user.id
            }
        });

        if (result.count === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Session not found or already revoked'
            });
        }

        writeAuditLog({
            actionType: 'SESSION_REVOKED_BY_ADMIN',
            actorAdminId: adminId || null,
            actorUserId: req.user.id,
            resourceType: 'user_session',
            resourceId: String(sessionId),
            details: { userId: targetUserId },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Session revoked successfully'
        });
    } catch (error) {
        console.error('Admin revokeUserSession error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error revoking user session'
        });
    }
};

// NOTE: getFlaggedPosts is defined later in this file (line ~4528)
// This duplicate has been removed to avoid confusion

exports.searchPosts = async (req, res) => {
    try {
        const { q, search, query, type, page = 1, limit = 10, status, dateFrom, dateTo, hasReports } = req.query;
        const searchQ = normalizeQuery(q) ?? normalizeQuery(search);
        let whereClause = {};
        if (searchQ) {
            whereClause = buildPostSearchWhere(searchQ, { status, dateFrom, dateTo, hasReports, excludeAds: false });
        } else if (query != null && type) {
            const validTypes = ['post_id', 'post_title', 'user_id', 'username', 'date', 'status'];
            if (!validTypes.includes(type)) {
                return res.status(400).json({ status: 'error', message: `Invalid search type. Must be one of: ${validTypes.join(', ')}` });
            }
            const qStr = String(query).trim();
            switch (type) {
                case 'post_id': whereClause.id = qStr; break;
                case 'post_title': whereClause.title = { contains: qStr, mode: 'insensitive' }; break;
                case 'user_id': whereClause.user_id = qStr; break;
                case 'username': whereClause.user = { username: { contains: qStr, mode: 'insensitive' } }; break;
                case 'date': {
                    const d = new Date(qStr);
                    if (Number.isNaN(d.getTime())) return res.status(400).json({ status: 'error', message: 'Invalid date format. Use YYYY-MM-DD' });
                    const nextDay = new Date(d.getTime() + 24 * 60 * 60 * 1000);
                    whereClause.createdAt = { gte: d, lt: nextDay };
                    break;
                }
                case 'status':
                    if (!['pending', 'approved', 'rejected', 'frozen', 'active', 'draft', 'suspended'].includes(qStr.toLowerCase())) {
                        return res.status(400).json({ status: 'error', message: 'Invalid status' });
                    }
                    whereClause.status = qStr.toLowerCase();
                    break;
            }
        } else {
            return res.status(400).json({ status: 'error', message: 'Provide q (or search) for aggressive search, or query and type for legacy search' });
        }

        const { pageNum, limitNum, offset } = parsePagination(page, limit, { maxLimit: 100 });
        const includeClause = {
            user: { select: { id: true, username: true, email: true, status: true, profile_picture: true, bio: true } },
            category: { select: { id: true, name: true } }
        };

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: whereClause,
                include: includeClause,
                orderBy: { createdAt: 'desc' },
                take: limitNum,
                skip: offset
            }),
            prisma.post.count({ where: whereClause })
        ]);

        const formattedPosts = posts.map(post => ({
            id: post.id,
            title: post.title,
            description: post.description,
            status: post.status,
            video_url: post.video_url,
            thumbnail_url: post.thumbnail_url,
            likes: post.likes,
            views: post.views,
            shares: post.shares,
            comments_count: post.comment_count,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            user_id: post.user_id,
            user: post.user,
            category: post.category
        }));

        res.json({
            status: 'success',
            data: {
                posts: formattedPosts,
                pagination: {
                    total: totalCount,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(totalCount / limitNum),
                    hasNext: pageNum * limitNum < totalCount,
                    hasPrev: pageNum > 1
                },
                searchInfo: {
                    query: searchQ || query,
                    type: searchQ ? 'aggressive' : type,
                    resultsCount: formattedPosts.length
                }
            }
        });
    } catch (error) {
        console.error('Error searching posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'An error occurred while searching posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getDashboardData = async (req, res) => {
    try {
        // Get counts for different post statuses
        const totalPosts = await prisma.post.count();
        const pendingPosts = await prisma.post.count({ where: { status: 'draft' } });
        const approvedPosts = await prisma.post.count({ where: { status: 'active' } });
        const rejectedPosts = await prisma.post.count({ where: { status: 'suspended' } });

        // Get recent posts with their authors and categories
        const recentPosts = await prisma.post.findMany({
            include: {
                author: {
                    select: {
                        id: true,
                        username: true
                    }
                },
                category: true
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 10
        });

        // Process media URLs for recent posts
        const processedPosts = recentPosts.map(post => {
            if (post.mediaUrl && !post.mediaUrl.startsWith('http')) {
                post.mediaUrl = `/uploads/${post.mediaUrl.replace(/^uploads\//, '')}`;
            }
            return post;
        });

        res.json({
            status: 'success',
            data: {
                stats: {
                    total: totalPosts,
                    pending: pendingPosts,
                    approved: approvedPosts,
                    rejected: rejectedPosts
                },
                recentPosts: processedPosts
            }
        });

    } catch (error) {
        console.error('Error in getDashboardData:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching dashboard data'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getPosts = async (req, res) => {
    try {
        const { status = 'all' } = req.query;
        
        const where = {};
        if (status !== 'all') {
            where.status = status;
        }

        const posts = await prisma.post.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                },
                approver: {
                    select: {
                        id: true,
                        username: true
                    }
                },
                category: true,
                likes: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true
                            }
                        }
                    }
                },
                comments: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true
                            }
                        }
                    }
                },
                shares: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true
                            }
                        }
                    }
                },
                views: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        res.json({
            status: 'success',
            data: posts
        });

    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching posts'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get pending posts
exports.getPendingPosts = async (req, res) => {
    try {
        const posts = await prisma.post.findMany({
            where: { status: 'draft' },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                },
                category: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        res.json({
            status: 'success',
            data: { posts }
        });
    } catch (error) {
        console.error('Error getting pending posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching pending posts'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update post status (approve/reject)
exports.updatePostStatus = async (req, res) => {
    try {
        console.log(req.body)
        const { status, rejectionReason } = req.body;
        console.log("Post: --------> " + req.body)
        
        // Find post with user information
        const post = await prisma.post.findUnique({
            where: { id: req.body.id },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            }
        });
        
        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        // Map status values to enum
        let mappedStatus;
        if (status === 'approved' || status === 'active') {
            mappedStatus = 'active';
        } else if (status === 'rejected' || status === 'suspended') {
            mappedStatus = 'suspended';
            if (!rejectionReason) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Rejection reason is required'
                });
            }
        } else if (status === 'pending' || status === 'draft') {
            mappedStatus = 'draft';
        } else {
            mappedStatus = status; // Use as-is if already valid enum value
        }

        if (mappedStatus === 'suspended' && !rejectionReason) {
            return res.status(400).json({
                status: 'error',
                message: 'Rejection reason is required'
            });
        }

        await prisma.post.update({
            where: { id: req.body.id },
            data: {
                status: mappedStatus,
                rejectionReason: mappedStatus === 'suspended' ? rejectionReason : null,
                approver_id: req.user.id,
                approved_at: mappedStatus === 'active' ? new Date() : null
            }
        });
        await invalidatePostCaches();

        // Create notification for post owner
        if (post.user && post.user.id) {
            // Create notification message based on status
            let notificationText = '';
            if (mappedStatus === 'active') {
                notificationText = `Your post "${post.title}" has been approved.`;
            } else if (mappedStatus === 'suspended') {
                notificationText = `Your post "${post.title}" has been rejected. Reason: ${rejectionReason}`;
            }

            // Insert notification (userID must be username, not user ID)
            if (post.user?.username) {
                const notification = await prisma.notification.create({
                    data: {
                        userID: post.user.username,
                        message: notificationText,
                        type: 'post_status_update',
                        isRead: false
                    }
                });

                // Emit real-time notification event
                const { emitEvent } = require('../lib/realtime');
                emitEvent('notification:created', {
                    userId: post.user.id,
                    userID: post.user.username,
                    notification: {
                        id: notification.id,
                        type: notification.type,
                        message: notification.message,
                        isRead: notification.isRead,
                        createdAt: notification.createdAt,
                        metadata: {
                            postId: post.id,
                            postTitle: post.title,
                            status: mappedStatus
                        }
                    }
                });
            }
            
            console.log(`Notification sent to user ${post.user.id} for post ${post.id} with status ${status}`);
        }

        // Check and auto-suspend user if they have 3+ suspended posts
        if (mappedStatus === 'suspended' && post.user_id) {
            const { checkAndSuspendUser } = require('../utils/userSuspensionService');
            const suspensionResult = await checkAndSuspendUser(post.user_id, req.body.id);
            
            if (suspensionResult.suspended) {
                console.log(`[Admin] User ${post.user?.username} automatically suspended: ${suspensionResult.message}`);
            }
        }

        res.json({
            status: 'success',
            message: `Post ${status} successfully`
        });
    } catch (error) {
        console.error('Error updating post status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error updating post status'
        });
    }
};

exports.getPostReportSuspendThreshold = async (_req, res) => {
    try {
        const threshold = await getPostReportSuspendThreshold();

        res.json({
            status: 'success',
            data: {
                post_report_suspend_threshold: threshold
            }
        });
    } catch (error) {
        console.error('Get post report threshold error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching post report suspension threshold'
        });
    }
};

exports.updatePostReportSuspendThreshold = async (req, res) => {
    try {
        const rawThreshold = req.body?.post_report_suspend_threshold;
        const parsedThreshold = Number.parseInt(rawThreshold, 10);

        if (!Number.isInteger(parsedThreshold) || parsedThreshold < 1) {
            return res.status(400).json({
                status: 'error',
                message: 'post_report_suspend_threshold must be an integer greater than or equal to 1'
            });
        }

        const threshold = await setPostReportSuspendThreshold(parsedThreshold);

        res.json({
            status: 'success',
            message: 'Post report suspension threshold updated successfully',
            data: {
                post_report_suspend_threshold: threshold
            }
        });
    } catch (error) {
        console.error('Update post report threshold error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error updating post report suspension threshold'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get admin dashboard stats
// DEPRECATED: This function has been replaced by the more comprehensive version at line 4616
// Keeping for backward compatibility but should be removed in future versions
// Use the version with date filtering instead

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Account Management
exports.manageUserAccount = async (req, res) => {
    try {
        const { id, action, reason } = req.body;

        // First, get the current user status
        const user = await prisma.user.findUnique({
            where: { id }
        });
        
        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Determine the new status based on current status and action
        let newStatus;
        if (action === 'freeze') {
            if (user.status === 'active') {
                newStatus = 'frozen';
            } else {
                return res.status(400).json({
                    status: 'error',
                    message: 'User is not active and cannot be frozen'
                });
            }
        } else if (action === 'reactivate') {
            if (user.status === 'frozen') {
                newStatus = 'active';
            } else {
                return res.status(400).json({
                    status: 'error',
                    message: 'User is not frozen and cannot be reactivated'
                });
            }
        } else if (action === 'suspend') {
            if (user.status === 'active' || user.status === 'frozen') {
                newStatus = 'suspended';
            } else {
                return res.status(400).json({
                    status: 'error',
                    message: 'User is already suspended'
                });
            }
        } else if (action === 'unsuspend') {
            if (user.status === 'suspended') {
                newStatus = 'active';
            } else {
                return res.status(400).json({
                    status: 'error',
                    message: 'User is not suspended and cannot be unsuspended'
                });
            }
        } else if (action === 'delete') {
            if (user.status === 'deleted') {
                return res.status(400).json({
                    status: 'error',
                    message: 'User is already deleted'
                });
            }
            newStatus = 'deleted';
        } else {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid action. Use "freeze", "reactivate", "suspend", "unsuspend", or "delete"'
            });
        }

        // Build update payload: status and optional suspended_at / suspension_reason
        const updateData = { status: newStatus };
        if (action === 'suspend') {
            updateData.suspended_at = new Date();
            updateData.suspension_reason = reason || null;
        } else if (action === 'unsuspend') {
            updateData.suspended_at = null;
            updateData.suspension_reason = null;
        }
        await prisma.user.update({
            where: { id },
            data: updateData
        });

        if (action === 'suspend') {
            emitEvent('user:account_suspended', {
                userId: id,
                reason: reason || null,
                suspended_at: updateData.suspended_at
            });
            adminNotificationService.create({
                severity: 'critical',
                category: 'security',
                title: 'User account suspended',
                message: `User ${user.username || user.email || id} was suspended by admin.${reason ? ` Reason: ${reason}` : ''}`,
                actionUrl: `/admin/users/${id}`,
                metadata: { userId: id, reason: reason || null },
            }).catch((err) => console.error('[Admin] Admin notification error:', err));
        }

        const adminId = await getAdminId(req.user?.id, req.user?.role);
        writeAuditLog({
            actionType: `ADMIN_${action.toUpperCase()}_USER`,
            resourceType: 'user',
            resourceId: id,
            actorAdminId: adminId || req.user?.id,
            details: { previousStatus: user.status, newStatus: newStatus, reason: reason || null },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: `Account ${action}d successfully`,
            data: {
                userId: id,
                previousStatus: user.status,
                newStatus: newStatus,
                ...(action === 'suspend' && { suspended_at: updateData.suspended_at, suspension_reason: updateData.suspension_reason }),
                ...(action === 'unsuspend' && { suspended_at: null, suspension_reason: null })
            }
        });
    } catch (error) {
        console.error('Error managing account:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error managing account',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getApprovedPosts = async (req, res) => {
    try {
        const { date, search, page = 1, limit = 10 } = req.query;
        const approverUsername = req.user.id;
        const whereClause = {
            status: 'active',
            // approver_id: approverUsername
        };

        if (date) {
            const searchDate = new Date(date);
            whereClause.approved_at = {
                gte: searchDate,
                lt: new Date(searchDate.getTime() + 24 * 60 * 60 * 1000)
            };
        }

        if (search) {
            whereClause.title = {
                contains: search,
                mode: 'insensitive'
            };
        }

        const [posts, total] = await Promise.all([
            prisma.post.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            username: true,
                            email: true
                        }
                    }
                },
                orderBy: {
                    approved_at: 'desc'
                },
                take: parseInt(limit),
                skip: (page - 1) * limit
            }),
            prisma.post.count({
                where: whereClause
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts: posts,
                total: total,
                pages: Math.ceil(total / limit),
                currentPage: parseInt(page)
            }
        });
    } catch (error) {
        console.error('Approved posts fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching approved posts'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Video Management
exports.getAllVideos = async (req, res) => {
    try {
        const videos = await prisma.post.findMany({
            include: {
                user: {
                    select: {
                        username: true
                    }
                }
            }
        });
        res.json({
            status: 'success',
            data: { videos }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Error fetching videos'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Approver Management
exports.registerApprover = async (req, res) => {
    try {
        const { email } = req.body;

        // Validate required fields
        if (!email) {
            return res.status(400).json({
                status: 'error',
                message: 'Email is required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid email format'
            });
        }

        // Check if approver exists with the same email
        const existingApprover = await prisma.approver.findUnique({
            where: { email: email.toLowerCase() }
        });

        if (existingApprover) {
            return res.status(409).json({
                status: 'error',
                message: 'Approver with this email already exists',
                data: {
                    exists: true,
                    field: 'email'
                }
            });
        }

        // Generate onboarding token
        const crypto = require('crypto');
        const onboardingToken = crypto.randomBytes(32).toString('hex');

        // Create new approver with pending status
        const approver = await prisma.approver.create({
            data: {
                email: email.toLowerCase(),
                onboarding_token: onboardingToken,
                password_set: false,
                status: 'pending'
            },
            select: {
                id: true,
                email: true,
                status: true,
                createdAt: true
            }
        });

        // Send onboarding email with link
        const { sendApproverOnboardingEmail } = require('../services/emailService');
        const frontendUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';
        const onboardingLink = `${frontendUrl}/approver/onboarding?token=${onboardingToken}`;
        
        try {
            await sendApproverOnboardingEmail(email, onboardingLink);
        } catch (emailError) {
            console.error('Error sending onboarding email:', emailError);
            // Continue even if email fails - admin can resend later
        }

        res.status(201).json({
            status: 'success',
            message: 'Approver created successfully. Onboarding link has been sent to their email.',
            data: {
                approver,
                onboardingLink: process.env.NODE_ENV === 'development' ? onboardingLink : undefined
            }
        });
    } catch (error) {
        console.error('Error registering approver:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error registering approver',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.removeApprover = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if approver exists
        const approver = await prisma.approver.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        posts: true
                    }
                }
            }
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        // Check if approver has any posts - warn but still allow deletion
        const hasPosts = approver._count.posts > 0;

        // Delete approver
        await prisma.approver.delete({
            where: { id }
        });

        res.json({
            status: 'success',
            message: 'Approver deleted successfully',
            data: {
                deletedApprover: {
                    id: approver.id,
                    username: approver.username,
                    email: approver.email
                },
                warning: hasPosts ? 'Approver had associated posts. Posts remain but approver reference removed.' : null
            }
        });
    } catch (error) {
        console.error('Error removing approver:', error);
        
        // Handle foreign key constraint errors
        if (error.code === 'P2003') {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot delete approver. They have associated records that need to be handled first.',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Error removing approver',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Deactivate approver (soft delete by setting status to inactive)
exports.deactivateApprover = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if approver exists
        const approver = await prisma.approver.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        posts: true
                    }
                }
            }
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        // Check if already inactive
        if (approver.status === 'inactive') {
            return res.status(400).json({
                status: 'error',
                message: 'Approver is already inactive'
            });
        }

        // Update approver status to inactive
        const updatedApprover = await prisma.approver.update({
            where: { id },
            data: {
                status: 'inactive',
                updatedAt: new Date()
            },
            select: {
                id: true,
                username: true,
                email: true,
                status: true,
                updatedAt: true
            }
        });

        res.json({
            status: 'success',
            message: 'Approver deactivated successfully',
            data: {
                approver: updatedApprover,
                totalPosts: approver._count.posts
            }
        });
    } catch (error) {
        console.error('Error deactivating approver:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error deactivating approver',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Activate approver (reactivate a deactivated approver)
exports.activateApprover = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if approver exists
        const approver = await prisma.approver.findUnique({
            where: { id }
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        // Check if already active
        if (approver.status === 'active') {
            return res.status(400).json({
                status: 'error',
                message: 'Approver is already active'
            });
        }

        // Update approver status to active
        const updatedApprover = await prisma.approver.update({
            where: { id },
            data: {
                status: 'active',
                updatedAt: new Date()
            },
            select: {
                id: true,
                username: true,
                email: true,
                status: true,
                updatedAt: true
            }
        });

        res.json({
            status: 'success',
            message: 'Approver activated successfully',
            data: {
                approver: updatedApprover
            }
        });
    } catch (error) {
        console.error('Error activating approver:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error activating approver',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Suspend approver (temporarily disable access)
exports.suspendApprover = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        // Check if approver exists
        const approver = await prisma.approver.findUnique({
            where: { id }
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        if (approver.status === 'suspended') {
            return res.status(400).json({
                status: 'error',
                message: 'Approver is already suspended'
            });
        }

        // Update approver status to suspended
        const updatedApprover = await prisma.approver.update({
            where: { id },
            data: {
                status: 'suspended',
                updatedAt: new Date()
            },
            select: {
                id: true,
                username: true,
                email: true,
                status: true,
                createdAt: true,
                last_login: true
            }
        });

        res.json({
            status: 'success',
            message: 'Approver suspended successfully',
            data: {
                approver: updatedApprover,
                reason: reason || 'Suspended by admin'
            }
        });
    } catch (error) {
        console.error('Error suspending approver:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error suspending approver',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get approver stats with time range filter
exports.getApproverStats = async (req, res) => {
    try {
        const { approverId } = req.params;
        const { period = 'days', value = 7 } = req.query; // period: hours, days, weeks, months, annual

        // Check if approver exists
        const approver = await prisma.approver.findUnique({
            where: { id: approverId },
            select: {
                id: true,
                username: true,
                email: true,
                status: true,
                createdAt: true,
                last_login: true
            }
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        // Calculate date range based on period
        const now = new Date();
        let startDate = new Date();

        switch (period) {
            case 'hours':
                startDate = new Date(now.getTime() - parseInt(value) * 60 * 60 * 1000);
                break;
            case 'days':
                startDate = new Date(now.getTime() - parseInt(value) * 24 * 60 * 60 * 1000);
                break;
            case 'weeks':
                startDate = new Date(now.getTime() - parseInt(value) * 7 * 24 * 60 * 60 * 1000);
                break;
            case 'months':
                startDate = new Date(now);
                startDate.setMonth(startDate.getMonth() - parseInt(value));
                break;
            case 'annual':
                startDate = new Date(now);
                startDate.setFullYear(startDate.getFullYear() - parseInt(value));
                break;
            default:
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Default: 7 days
        }

        // Get stats for the time period
        const [
            totalReviewed,
            approvedCount,
            rejectedCount,
            suspendedCount,
            averageResponseTime
        ] = await Promise.all([
            // Total reviewed posts
            prisma.post.count({
                where: {
                    approver_id: approverId,
                    updatedAt: {
                        gte: startDate
                    }
                }
            }),
            // Approved posts
            prisma.post.count({
                where: {
                    approver_id: approverId,
                    status: 'active',
                    updatedAt: {
                        gte: startDate
                    }
                }
            }),
            // Rejected posts (suspended status)
            prisma.post.count({
                where: {
                    approver_id: approverId,
                    status: 'suspended',
                    updatedAt: {
                        gte: startDate
                    }
                }
            }),
            // Suspended posts
            prisma.post.count({
                where: {
                    approver_id: approverId,
                    status: 'suspended',
                    updatedAt: {
                        gte: startDate
                    }
                }
            }),
            // Calculate average response time (time between post creation and approval/rejection)
            prisma.post.findMany({
                where: {
                    approver_id: approverId,
                    updatedAt: {
                        gte: startDate
                    },
                    approved_at: {
                        not: null
                    }
                },
                select: {
                    createdAt: true,
                    approved_at: true
                }
            })
        ]);

        // Calculate average response time in hours
        let avgResponseTime = 0;
        if (averageResponseTime.length > 0) {
            const totalResponseTime = averageResponseTime.reduce((sum, post) => {
                if (post.approved_at) {
                    const responseTime = post.approved_at.getTime() - post.createdAt.getTime();
                    return sum + responseTime;
                }
                return sum;
            }, 0);
            avgResponseTime = (totalResponseTime / averageResponseTime.length) / (1000 * 60 * 60); // Convert to hours
        }

        // Get recent activity (last 10 actions)
        const recentActivity = await prisma.post.findMany({
            where: {
                approver_id: approverId,
                updatedAt: {
                    gte: startDate
                }
            },
            select: {
                id: true,
                title: true,
                status: true,
                updatedAt: true,
                user: {
                    select: {
                        username: true
                    }
                }
            },
            orderBy: {
                updatedAt: 'desc'
            },
            take: 10
        });

        res.json({
            status: 'success',
            data: {
                approver: {
                    id: approver.id,
                    username: approver.username,
                    email: approver.email,
                    status: approver.status,
                    joinedDate: approver.createdAt,
                    lastActive: approver.last_login
                },
                period: {
                    type: period,
                    value: parseInt(value),
                    startDate,
                    endDate: now
                },
                statistics: {
                    totalReviewed,
                    approved: approvedCount,
                    rejected: rejectedCount,
                    suspended: suspendedCount,
                    approvalRate: totalReviewed > 0 ? ((approvedCount / totalReviewed) * 100).toFixed(2) : 0,
                    rejectionRate: totalReviewed > 0 ? ((rejectedCount / totalReviewed) * 100).toFixed(2) : 0,
                    averageResponseTimeHours: avgResponseTime.toFixed(2)
                },
                recentActivity
            }
        });
    } catch (error) {
        console.error('Error fetching approver stats:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching approver statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get approver analytics for graphs
exports.getApproverAnalytics = async (req, res) => {
    try {
        const { approverId } = req.params;
        const { period = 'days', value = 30, groupBy = 'day' } = req.query;

        // Check if approver exists
        const approver = await prisma.approver.findUnique({
            where: { id: approverId },
            select: {
                id: true,
                username: true,
                email: true
            }
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        // Calculate date range
        const now = new Date();
        let startDate = new Date();

        switch (period) {
            case 'hours':
                startDate = new Date(now.getTime() - parseInt(value) * 60 * 60 * 1000);
                break;
            case 'days':
                startDate = new Date(now.getTime() - parseInt(value) * 24 * 60 * 60 * 1000);
                break;
            case 'weeks':
                startDate = new Date(now.getTime() - parseInt(value) * 7 * 24 * 60 * 60 * 1000);
                break;
            case 'months':
                startDate = new Date(now);
                startDate.setMonth(startDate.getMonth() - parseInt(value));
                break;
            case 'annual':
                startDate = new Date(now);
                startDate.setFullYear(startDate.getFullYear() - parseInt(value));
                break;
            default:
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        // Get all posts reviewed in the period
        const posts = await prisma.post.findMany({
            where: {
                approver_id: approverId,
                updatedAt: {
                    gte: startDate
                }
            },
            select: {
                id: true,
                status: true,
                updatedAt: true,
                approved_at: true
            },
            orderBy: {
                updatedAt: 'asc'
            }
        });

        // Group data by time period
        const analyticsData = {};

        posts.forEach(post => {
            const date = new Date(post.updatedAt);
            let key = '';

            if (groupBy === 'hour') {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;
            } else if (groupBy === 'day') {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            } else if (groupBy === 'week') {
                const week = Math.ceil(date.getDate() / 7);
                key = `${date.getFullYear()}-W${String(week).padStart(2, '0')}`;
            } else if (groupBy === 'month') {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            } else {
                key = `${date.getFullYear()}`;
            }

            if (!analyticsData[key]) {
                analyticsData[key] = {
                    date: key,
                    approved: 0,
                    rejected: 0,
                    suspended: 0,
                    total: 0
                };
            }

            analyticsData[key].total++;
            if (post.status === 'active') {
                analyticsData[key].approved++;
            } else if (post.status === 'suspended') {
                analyticsData[key].rejected++;
                analyticsData[key].suspended++;
            }
        });

        // Convert to array and sort by date
        const chartData = Object.values(analyticsData).sort((a, b) => {
            return new Date(a.date) - new Date(b.date);
        });

        // Calculate totals
        const totals = {
            approved: posts.filter(p => p.status === 'active').length,
            rejected: posts.filter(p => p.status === 'suspended').length,
            suspended: posts.filter(p => p.status === 'suspended').length,
            total: posts.length
        };

        res.json({
            status: 'success',
            data: {
                approver: {
                    id: approver.id,
                    username: approver.username,
                    email: approver.email
                },
                period: {
                    type: period,
                    value: parseInt(value),
                    groupBy,
                    startDate,
                    endDate: now
                },
                chartData,
                totals
            }
        });
    } catch (error) {
        console.error('Error fetching approver analytics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching approver analytics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get reviewed posts by approver with decisions
exports.getApproverReviewedPosts = async (req, res) => {
    try {
        const { approverId } = req.params;
        const { page = 1, limit = 20, status, decision, startDate, endDate } = req.query;
        const offset = (page - 1) * limit;

        // Check if approver exists
        const approver = await prisma.approver.findUnique({
            where: { id: approverId },
            select: {
                id: true,
                username: true,
                email: true,
                status: true
            }
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        // Build where clause
        const whereClause = {
            approver_id: approverId
        };

        // Filter by status/decision
        if (status || decision) {
            const decisionStatus = status || decision;
            if (['active', 'approved', 'rejected', 'suspended'].includes(decisionStatus)) {
                // Map user-friendly status names to enum values
                if (decisionStatus === 'approved') {
                    whereClause.status = 'active';
                } else if (decisionStatus === 'rejected') {
                    whereClause.status = 'suspended';
                } else {
                    whereClause.status = decisionStatus;
                }
            }
        }

        // Filter by date range
        if (startDate || endDate) {
            whereClause.updatedAt = {};
            if (startDate) {
                whereClause.updatedAt.gte = new Date(startDate);
            }
            if (endDate) {
                whereClause.updatedAt.lte = new Date(endDate);
            }
        }

        // Get posts with decisions
        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                            profile_picture: true
                        }
                    },
                    category: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                },
                orderBy: {
                    updatedAt: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: whereClause
            })
        ]);

        // Format posts with decision information
        const formattedPosts = posts.map(post => ({
            id: post.id,
            title: post.title,
            description: post.description,
            video_url: post.video_url,
            status: post.status,
            decision: post.status === 'active' ? 'approved' : 
                    post.status === 'suspended' ? 'rejected' : 
                    post.status === 'draft' ? 'pending' : post.status,
            reviewedAt: post.updatedAt,
            approvedAt: post.approved_at,
            user: post.user,
            category: post.category,
            views: post.views,
            likes: post.likes,
            shares: post.shares
        }));

        // Get decision statistics
        const [approvedCount, rejectedCount, suspendedCount] = await Promise.all([
            prisma.post.count({
                where: {
                    approver_id: approverId,
                    status: 'active',
                    ...(startDate || endDate ? {
                        updatedAt: {
                            ...(startDate ? { gte: new Date(startDate) } : {}),
                            ...(endDate ? { lte: new Date(endDate) } : {})
                        }
                    } : {})
                }
            }),
            prisma.post.count({
                where: {
                    approver_id: approverId,
                    status: 'suspended',
                    ...(startDate || endDate ? {
                        updatedAt: {
                            ...(startDate ? { gte: new Date(startDate) } : {}),
                            ...(endDate ? { lte: new Date(endDate) } : {})
                        }
                    } : {})
                }
            }),
            prisma.post.count({
                where: {
                    approver_id: approverId,
                    status: 'suspended',
                    ...(startDate || endDate ? {
                        updatedAt: {
                            ...(startDate ? { gte: new Date(startDate) } : {}),
                            ...(endDate ? { lte: new Date(endDate) } : {})
                        }
                    } : {})
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                approver: {
                    id: approver.id,
                    username: approver.username,
                    email: approver.email,
                    status: approver.status
                },
                posts: formattedPosts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                },
                statistics: {
                    total: totalCount,
                    approved: approvedCount,
                    rejected: rejectedCount,
                    suspended: suspendedCount,
                    approvalRate: totalCount > 0 ? ((approvedCount / totalCount) * 100).toFixed(2) : 0
                }
            }
        });
    } catch (error) {
        console.error('Error fetching reviewed posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching reviewed posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Messaging
exports.sendMessageToAllUsers = async (req, res) => {
    try {
        const { message } = req.body;

        const users = await User.findAll({
            attributes: ['username']
        });

        await Promise.all(users.map(user => 
            Notification.create({
                userID: user.username,
                notification_text: message,
                notification_date: new Date()
            })
        ));

        res.json({
            status: 'success',
            message: 'Message sent to all users successfully'
        });
    } catch (error) {
        console.error('Message sending error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error sending message'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.sendMessageToApprovers = async (req, res) => {
    try {
        const { message } = req.body;

        const approvers = await Approver.findAll({
            attributes: ['username']
        });

        await Promise.all(approvers.map(approver => 
            Notification.create({
                userID: approver.username,
                notification_text: message,
                notification_date: new Date()
            })
        ));

        res.json({
            status: 'success',
            message: 'Message sent to all approvers successfully'
        });
    } catch (error) {
        console.error('Message sending error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error sending message'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Statistics and Reports
exports.getAdminDashboardStats = async (req, res) => {
    try {
        const [
            totalUsers,
            totalApprovers,
            totalPosts,
            pendingPosts,
            approvedPosts
        ] = await Promise.all([
            User.count(),
            Approver.count(),
            Post.count(),
            Post.count({ where: { status: 'draft' } }),
            Post.count({ where: { status: 'active' } })
        ]);

        res.json({
            status: 'success',
            data: {
                totalUsers,
                totalApprovers,
                totalPosts,
                pendingPosts,
                approvedPosts
            }
        });
    } catch (error) {
        console.error('Stats fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching dashboard statistics'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.uploadAd = async (req, res) => {
    try {
        const adminUsername = req.user.username;
        
        const admin = await Admin.findByPk(adminUsername);
        if (!admin.ads_management) {
            return res.status(403).json({
                status: 'error',
                message: 'Not authorized to manage ads'
            });
        }

        await Ad.create({
            uploaderID: adminUsername,
            ad_video: req.file.buffer,
            status: 'active'
        });

        res.status(201).json({
            status: 'success',
            message: 'Ad uploaded successfully'
        });
    } catch (error) {
        console.error('Ad upload error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error uploading ad'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const { q, search, page = 1, limit = 50, status, role, dateFrom, dateTo, suspended, country_id } = req.query;
        const searchQuery = normalizeQuery(q) ?? normalizeQuery(search);
        const userWhere = buildUserSearchWhere(searchQuery ?? '', { status, role, dateFrom, dateTo, suspended, country_id });
        const { pageNum, limitNum, offset } = parsePagination(page, limit, { maxLimit: 100 });

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: userWhere,
                select: {
                    id: true,
                    username: true,
                    display_name: true,
                    email: true,
                    createdAt: true,
                    status: true,
                    posts_count: true,
                    phone1: true,
                    phone2: true,
                    last_active_date: true,
                    profile_picture: true,
                    bio: true,
                    last_login: true,
                    date_of_birth: true,
                    country_id: true,
                    follower_count: true,
                    total_profile_views: true,
                    interests: true,
                    role: true
                },
                orderBy: { createdAt: 'desc' },
                take: limitNum,
                skip: offset
            }),
            prisma.user.count({ where: userWhere })
        ]);

        const userIds = users.map(u => u.id);
        let approvedCountMap = {}; let pendingCountMap = {}; let totalViewsMap = {}; let suspendedCountMap = {};
        if (userIds.length > 0) {
            const basePostWhere = { user_id: { in: userIds } };
            const [approvedCounts, pendingCounts, userViews, suspendedCounts] = await Promise.all([
                prisma.post.groupBy({ by: ['user_id'], where: { ...basePostWhere, status: 'active' }, _count: { id: true } }),
                prisma.post.groupBy({ by: ['user_id'], where: { ...basePostWhere, status: 'draft' }, _count: { id: true } }),
                prisma.post.groupBy({ by: ['user_id'], where: basePostWhere, _sum: { views: true } }),
                prisma.post.groupBy({ by: ['user_id'], where: { ...basePostWhere, status: 'suspended' }, _count: { id: true } })
            ]);
            approvedCounts.forEach(c => { approvedCountMap[c.user_id] = c._count.id; });
            pendingCounts.forEach(c => { pendingCountMap[c.user_id] = c._count.id; });
            userViews.forEach(v => { totalViewsMap[v.user_id] = v._sum.views || 0; });
            suspendedCounts.forEach(c => { suspendedCountMap[c.user_id] = c._count.id; });
        }

        const enhancedUsers = users.map(user => {
            const suspendedPostsCount = suspendedCountMap[user.id] || 0;
            return {
                ...user,
                postsApproved: approvedCountMap[user.id] || 0,
                postsPending: pendingCountMap[user.id] || 0,
                totalPostViews: totalViewsMap[user.id] || 0,
                suspendedPostsCount,
                isAtSuspensionThreshold: suspendedPostsCount >= 3 && user.status === 'active'
            };
        });

        res.json({
            message: 'Users fetched successfully',
            status: 'success',
            data: {
                users: enhancedUsers,
                pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
            }
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching users'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getRecentActivity = async (req, res) => {
    try {
        const recentPosts = await Post.findAll({
            limit: 10,
            order: [['updatedAt', 'DESC']],
            include: [
                {
                    model: User,
                    attributes: ['username']
                },
                {
                    model: Approver,
                    attributes: ['username']
                }
            ]
        });

        const activity = recentPosts.map(post => ({
            action: post.status === 'active' ? 'Video Approved' : 
                    post.status === 'suspended' ? 'Video Rejected' : 
                    'Video Submitted',
            user: post.User?.username || 'Unknown User',
            approver: post.Approver?.username,
            details: `Video: ${post.title}`,
            date: post.updatedAt
        }));

        res.json({
            status: 'success',
            data: activity
        });
    } catch (error) {
        console.error('Error getting recent activity:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get recent activity'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getApprovers = async (req, res) => {
    try {
        const approvers = await prisma.approver.findMany({
            select: {
                id: true,
                username: true,
                email: true,
                status: true,
                createdAt: true,
                last_login: true,
                _count: {
                    select: {
                        posts: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Get approved post counts for each approver
        const approverIds = approvers.map(a => a.id);
        const approvedCounts = await Promise.all(
            approverIds.map(approverId =>
                prisma.post.count({
                    where: {
                        approver_id: approverId,
                        status: 'active'
                    }
                })
            )
        );

        // Process approvers data
        const processedApprovers = approvers.map((approver, index) => ({
            id: approver.id,
            username: approver.username,
            email: approver.email,
            status: approver.status,
            joinedDate: approver.createdAt,
            lastActive: approver.last_login,
            totalApprovedPosts: approvedCounts[index] || 0,
            totalPosts: approver._count.posts || 0,
            performance: {
                approvalRate: approver._count.posts > 0 
                    ? ((approvedCounts[index] || 0) / approver._count.posts * 100).toFixed(2) 
                    : 0,
                averageResponseTime: 0
            }
        }));

        res.json({
            status: 'success',
            data: {
                approvers: processedApprovers,
                total: processedApprovers.length
            }
        });

    } catch (error) {
        console.error('Error fetching approvers:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch approvers',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getApproverDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const approver = await Approver.findByPk(id, {
            attributes: [
                'id',
                'username',
                'email',
                'status',
                'createdAt',
                'lastLoginAt'
            ]
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        // Get recent approved posts using a separate query
        const recentPosts = await prisma.post.findMany({
            where: { approver_id: id },
            select: {
                id: true,
                title: true,
                status: true,
                createdAt: true
            },
            take: 10,
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Get statistics
        const stats = await prisma.post.groupBy({
            by: ['status'],
            where: { approver_id: id },
            _count: {
                id: true
            }
        });

        // Process statistics
        const statistics = {
            approved: 0,
            rejected: 0,
            pending: 0
        };

        stats.forEach(stat => {
            statistics[stat.status] = parseInt(stat.getDataValue('count'));
        });

        // Calculate average response time
        const averageResponseTime = await Post.findOne({
            where: { approver_id: id },
            attributes: [
                [
                    sequelize.fn('AVG', 
                        sequelize.fn('EXTRACT', sequelize.literal('EPOCH FROM (\"updatedAt\" - \"createdAt\")')
                    )),
                    'avgResponseTime'
                ]
            ]
        });

        res.json({
            status: 'success',
            data: {
                approver: {
                    id: approver.id,
                    username: approver.username,
                    email: approver.email,
                    status: approver.status,
                    joinedDate: approver.createdAt,
                    lastActive: approver.lastLoginAt,
                    statistics: {
                        ...statistics,
                        totalPosts: Object.values(statistics).reduce((a, b) => a + b, 0),
                        averageResponseTime: averageResponseTime?.getDataValue('avgResponseTime') || 0
                    },
                    recentActivity: recentPosts.map(post => ({
                        id: post.id,
                        title: post.title,
                        status: post.status,
                        date: post.createdAt
                    }))
                }
            }
        });

    } catch (error) {
        console.error('Error fetching approver details:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch approver details'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.updateApproverStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const approver = await Approver.findByPk(id);

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        await approver.update({ status });

        res.json({
            status: 'success',
            message: 'Approver status updated successfully',
            data: {
                id: approver.id,
                username: approver.username,
                status: approver.status
            }
        });

    } catch (error) {
        console.error('Error updating approver status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update approver status'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Profile Management
exports.getProfile = async (req, res) => {
    try {
        const admin = await Admin.findByPk(req.user.id, {
            attributes: ['id', 'username', 'email', 'createdAt', 'lastLoginAt']
        });

        if (!admin) {
            return res.status(404).json({
                status: 'error',
                message: 'Admin profile not found'
            });
        }

        res.json({
            status: 'success',
            data: {
                profile: {
                    id: admin.id,
                    username: admin.username,
                    email: admin.email,
                    joinedDate: admin.createdAt,
                    lastActive: admin.lastLoginAt
                }
            }
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching admin profile'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { username, email } = req.body;
        const admin = await Admin.findByPk(req.user.id);

        if (!admin) {
            return res.status(404).json({
                status: 'error',
                message: 'Admin profile not found'
            });
        }

        // Check if username or email already exists
        const existingAdmin = await Admin.findOne({
            where: {
                [Op.and]: [
                    { id: { [Op.ne]: req.user.id } },
                    { [Op.or]: [{ username }, { email }] }
                ]
            }
        });

        if (existingAdmin) {
            return res.status(400).json({
                status: 'error',
                message: 'Username or email already exists'
            });
        }

        await admin.update({
            username,
            email,
            updatedAt: new Date()
        });

        res.json({
            status: 'success',
            message: 'Profile updated successfully',
            data: {
                profile: {
                    id: admin.id,
                    username: admin.username,
                    email: admin.email,
                    updatedAt: admin.updatedAt
                }
            }
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error updating admin profile'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const admin = await Admin.findByPk(req.user.id);

        if (!admin) {
            return res.status(404).json({
                status: 'error',
                message: 'Admin profile not found'
            });
        }

        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, admin.password);
        if (!isValidPassword) {
            return res.status(401).json({
                status: 'error',
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        await admin.update({
            password: hashedPassword,
            updatedAt: new Date()
        });

        res.json({
            status: 'success',
            message: 'Password changed successfully'
        });
    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error changing password'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Add these new methods
exports.getRecentPosts = async (req, res) => {
    try {
        const posts = await Post.findAll({
            include: [{
                model: User,
                as: 'author',
                attributes: ['username'],
                foreignKey: 'user_id'
            }],
            order: [['createdAt', 'DESC']],
            limit: 10
        });

        res.json({
            status: 'success',
            posts
        });
    } catch (error) {
        console.error('Error fetching recent posts:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Failed to fetch recent posts' 
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getMostViewedPosts = async (req, res) => {
    try {
        const posts = await Post.findAll({
            include: [{
                model: User,
                as: 'author',
                attributes: ['username'],
                foreignKey: 'user_id'
            }],
            order: [['views', 'DESC']],
            limit: 10
        });

        res.json({
            status: 'success',
            posts
        });
    } catch (error) {
        console.error('Error fetching most viewed posts:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Failed to fetch most viewed posts' 
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.searchByTraceId = async (req, res) => {
    try {
        const { type, id } = req.params;

        if (type === 'post') {
            const post = await prisma.post.findUnique({
                where: { id: id },
                include: {
                    user: {
                        select: {
                            username: true,
                            email: true
                        }
                    }
                }
            });

            if (!post) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Post not found'
                });
            }

            res.json({
                status: 'success',
                post
            });
        } else if (type === 'user') {
            const user = await User.findOne({
                where: { id },
                attributes: { exclude: ['password'] }
            });

            if (!user) {
                return res.status(404).json({
                    status: 'error',
                    message: 'User not found'
                });
            }

            res.json({
                status: 'success',
                user
            });
        } else {
            res.status(400).json({
                status: 'error',
                message: 'Invalid search type'
            });
        }
    } catch (error) {
        console.error('Error searching by trace ID:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Failed to search by ID' 
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getRejectedPosts = async (req, res) => {
    try {
        const posts = await prisma.post.findMany({
            where: {
                status: 'suspended'
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                },
                category: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Add full URLs for playback (HLS when ready, else raw)
        const postsWithUrls = posts.map(post => withVideoPlaybackUrl(post));

        res.json({
            status: 'success',
            data: postsWithUrls
        });
    } catch (error) {
        console.error('Error getting rejected posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error getting rejected posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getAllApprovedPostsByApprover = async (req, res) => {
    try {
        const { approverId } = req.params;
        const { page = 1, limit = 10, status } = req.query;
        const offset = (page - 1) * limit;

        // Check if the approver exists
        const approver = await prisma.approver.findUnique({
            where: { id: approverId },
            select: {
                id: true,
                username: true,
                email: true,
                status: true
            }
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Approver not found'
            });
        }

        // Build where clause
        const whereClause = {
            approver_id: approverId
        };

        // Filter by status if provided (map user-friendly names to enum values)
        if (status === 'approved' || status === 'active') {
            whereClause.status = 'active';
        } else if (status === 'rejected' || status === 'suspended') {
            whereClause.status = 'suspended';
        } else {
            // Default: get both approved and rejected (active and suspended)
            whereClause.status = {
                in: ['active', 'suspended']
            };
        }

        // Get posts with pagination
        const [posts, totalCount, approvedCount, rejectedCount] = await Promise.all([
            prisma.post.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                            profile_picture: true
                        }
                    },
                    category: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                },
                orderBy: {
                    updatedAt: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: whereClause
            }),
            prisma.post.count({
                where: {
                    approver_id: approverId,
                    status: 'active'
                }
            }),
            prisma.post.count({
                where: {
                    approver_id: approverId,
                    status: 'suspended'
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                approver: {
                    id: approver.id,
                    username: approver.username,
                    email: approver.email,
                    status: approver.status
                },
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                },
                statistics: {
                    totalApproved: approvedCount,
                    totalRejected: rejectedCount,
                    totalProcessed: approvedCount + rejectedCount
                }
            }
        });
    } catch (error) {
        console.error('Error getting posts by approver:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error getting posts by approver',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getUsersStats = async (req, res) => {
    try {
        // Get total number of users
        const totalUsers = await prisma.user.count();

        // Get number of active users
        const activeUsers = await prisma.user.count({
            where: {
                status: 'active'
            }
        });

        // Get number of frozen users (user status, not post status)
        const frozenUsers = await prisma.user.count({
            where: {
                status: 'frozen'
            }
        });

        // Get total number of posts
        const totalPosts = await prisma.post.count();

        // Get number of approved posts (active status)
        const approvedPosts = await prisma.post.count({
            where: {
                status: 'active'
            }
        });

        // Get number of pending posts (draft status)
        const pendingPosts = await prisma.post.count({
            where: {
                status: 'draft'
            }
        });

        res.json({
            status: 'success',
            data: {
                users: {
                    total: totalUsers,
                    active: activeUsers,
                    frozen: frozenUsers
                },
                posts: {
                    total: totalPosts,
                    approved: approvedPosts,
                    pending: pendingPosts
                }
            }
        });
    } catch (error) {
        console.error('Error fetching user stats:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching user statistics'
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getUserStats = async (req, res) => {
    try {
        const { period = '30d' } = req.query;
        
        // Calculate date range based on period
        const now = new Date();
        let startDate;
        
        switch (period) {
            case '1d':
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '90d':
                startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case '1y':
                startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        // Get user statistics using Prisma
        const [
            totalUsers,
            activeUsers,
            suspendedUsers,
            newUsersInPeriod,
            registrationRate,
            ageDistribution,
            topCountries,
            usersWithPosts,
            usersWithVerifiedEmail
        ] = await Promise.all([
            // Total Users
            prisma.user.count(),
            
            // Active Users
            prisma.user.count({ where: { status: 'active' } }),
            
            // Suspended Users
            prisma.user.count({ where: { status: 'suspended' } }),
            
            // New Users in Period
            prisma.user.count({
                where: { 
                    createdAt: { gte: startDate }
                }
            }),
            
            // Registration Rate (users per day in period)
            prisma.$queryRaw`
                SELECT 
                    COUNT(*) FILTER (WHERE "createdAt" >= ${startDate}) as total_registrations,
                    COUNT(*) FILTER (WHERE "createdAt" >= ${startDate})::float / NULLIF(EXTRACT(EPOCH FROM (NOW() - ${startDate})) / 86400, 0) as registrations_per_day,
                    (SELECT COUNT(*) FROM "users" WHERE DATE("createdAt") = CURRENT_DATE) as today_registrations
                FROM "users"
            `,
            
            // Age Distribution
            prisma.$queryRaw`
                WITH age_groups AS (
                    SELECT 
                        CASE 
                            WHEN "date_of_birth" IS NULL THEN 'Unknown'
                            WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) < 18 THEN 'Under 18'
                            WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 18 AND 24 THEN '18-24'
                            WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 25 AND 34 THEN '25-34'
                            WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 35 AND 44 THEN '35-44'
                            WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 45 AND 54 THEN '45-54'
                            WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 55 AND 64 THEN '55-64'
                            ELSE '65+'
                        END as age_group
                    FROM "users"
                )
                SELECT 
                    age_group,
                    COUNT(*) as count,
                    ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM "users"), 0), 2) as percentage
                FROM age_groups
                GROUP BY age_group
                ORDER BY 
                    CASE age_group
                        WHEN 'Under 18' THEN 1
                        WHEN '18-24' THEN 2
                        WHEN '25-34' THEN 3
                        WHEN '35-44' THEN 5
                        WHEN '45-54' THEN 6
                        WHEN '55-64' THEN 7
                        WHEN '65+' THEN 8
                        WHEN 'Unknown' THEN 9
                        ELSE 10
                    END
            `,
            
            // Top 3 Countries with Most Users
            prisma.$queryRaw`
                SELECT 
                    c.id,
                    c.name as country,
                    c.flag_emoji,
                    COUNT(u.id) as user_count,
                    ROUND(COUNT(u.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM "users"), 0), 2) as percentage
                FROM "users" u
                JOIN "countries" c ON u.country_id = c.id
                GROUP BY c.id, c.name, c.flag_emoji
                ORDER BY user_count DESC
                LIMIT 3
            `,
            
            // Users with Posts
            prisma.user.count({
                where: {
                    posts_count: { gt: 0 }
                }
            }),
            
            // Users with Verified Email
            prisma.user.count({
                where: {
                    email_verified: true
                }
            })
        ]);

        // Calculate registration growth rate
        const daysInPeriod = Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const regRate = registrationRate[0];
        const avgRegistrationsPerDay = regRate?.registrations_per_day || 0;

        res.json({
            status: 'success',
            data: {
                period,
                users: {
                    total: totalUsers,
                    active: activeUsers,
                    suspended: suspendedUsers,
                    newInPeriod: newUsersInPeriod,
                    withPosts: usersWithPosts,
                    withVerifiedEmail: usersWithVerifiedEmail,
                    withoutPosts: totalUsers - usersWithPosts
                },
                registration: {
                    newUsers: newUsersInPeriod,
                    periodDays: daysInPeriod,
                    averagePerDay: Math.round(avgRegistrationsPerDay * 100) / 100,
                    todayRegistrations: Number(regRate?.today_registrations || 0),
                    growthRate: totalUsers > 0 
                        ? Math.round((newUsersInPeriod / totalUsers) * 10000) / 100 
                        : 0
                },
                ageDistribution: ageDistribution.map(item => ({
                    ageGroup: item.age_group,
                    count: Number(item.count),
                    percentage: Number(item.percentage)
                })),
                topCountries: topCountries.map(item => ({
                    id: Number(item.id),
                    country: item.country,
                    flagEmoji: item.flag_emoji,
                    userCount: Number(item.user_count),
                    percentage: Number(item.percentage)
                })),
                engagement: {
                    usersWithPosts: usersWithPosts,
                    usersWithoutPosts: totalUsers - usersWithPosts,
                    postCreationRate: totalUsers > 0 
                        ? Math.round((usersWithPosts / totalUsers) * 10000) / 100 
                        : 0
                },
                verification: {
                    verified: usersWithVerifiedEmail,
                    unverified: totalUsers - usersWithVerifiedEmail,
                    verificationRate: totalUsers > 0 
                        ? Math.round((usersWithVerifiedEmail / totalUsers) * 10000) / 100 
                        : 0
                }
            }
        });
    } catch (error) {
        console.error('Error getting user stats:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching user statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get flagged posts (posts with 5+ reports or manually flagged by admin/approver)
// Flagged posts have status 'suspended' and is_frozen: true
exports.getFlaggedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    category: true,
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    frozen_at: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'suspended',
                    is_frozen: true
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get flagged posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching flagged posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===== NEW ADMIN ANALYTICS & MANAGEMENT ENDPOINTS =====

/** Start of window for admin dashboard `period` query (same keys as legacy dashboard). */
function adminDashboardPeriodStartDate(period) {
    const now = new Date();
    switch (period) {
        case '1h':
            return new Date(now.getTime() - 60 * 60 * 1000);
        case '1d':
            return new Date(now.getTime() - 24 * 60 * 60 * 1000);
        case '7d':
            return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        case '1m':
            return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        case '3m':
            return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        case '1y':
            return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        default:
            return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
}

/**
 * Post/content counts for admin. Pass createdAtGte=null for all-time (matches /admin/posts/all totals).
 */
async function computeAdminPostMetrics(createdAtGte) {
    const dw = createdAtGte ? { createdAt: { gte: createdAtGte } } : {};
    const [
        totalPosts,
        activePosts,
        draftPosts,
        suspendedPosts,
        videosWithPublicUrl,
        videosByType,
        imagesWithPublicUrl,
        videoUploading,
        videoPendingOrProcessing,
        featuredPosts,
        frozenPosts,
        aggregateViews,
    ] = await Promise.all([
        prisma.post.count({ where: dw }),
        prisma.post.count({ where: { ...dw, status: 'active' } }),
        prisma.post.count({ where: { ...dw, status: 'draft' } }),
        prisma.post.count({ where: { ...dw, status: 'suspended' } }),
        prisma.post.count({ where: { ...dw, type: 'video', video_url: { not: null } } }),
        prisma.post.count({ where: { ...dw, type: 'video' } }),
        prisma.post.count({ where: { ...dw, type: 'image', video_url: { not: null } } }),
        prisma.post.count({ where: { ...dw, type: 'video', processing_status: 'uploading' } }),
        prisma.post.count({
            where: {
                ...dw,
                type: 'video',
                processing_status: { in: ['pending', 'processing'] },
            },
        }),
        prisma.post.count({ where: { ...dw, is_featured: true } }),
        prisma.post.count({ where: { ...dw, is_frozen: true } }),
        prisma.post.aggregate({ where: dw, _sum: { views: true } }),
    ]);

    const sumPostViewsField = aggregateViews._sum.views != null ? aggregateViews._sum.views : 0;

    return {
        totalPosts,
        byStatus: { active: activePosts, draft: draftPosts, suspended: suspendedPosts },
        videos: {
            withPublicAsset: videosWithPublicUrl,
            typeVideoCount: videosByType,
            uploading: videoUploading,
            pendingOrProcessing: videoPendingOrProcessing,
        },
        imagesWithPublicAsset: imagesWithPublicUrl,
        featured: featuredPosts,
        frozen: frozenPosts,
        sumPostViewsField,
    };
}

async function computeEngagementTotalsSince(startDate) {
    const [likes, comments, shares] = await Promise.all([
        prisma.postLike.count({ where: { createdAt: { gte: startDate } } }),
        prisma.comment.count({ where: { comment_date: { gte: startDate } } }),
        prisma.share.count({ where: { createdAt: { gte: startDate } } }),
    ]);
    return { likes, comments, shares, total: likes + comments + shares };
}

async function computeEngagementTotalsAllTime() {
    const [likes, comments, shares] = await Promise.all([
        prisma.postLike.count(),
        prisma.comment.count(),
        prisma.share.count(),
    ]);
    return { likes, comments, shares, total: likes + comments + shares };
}

/**
 * GET /api/admin/stats/overview
 * Canonical stats for admin portal: all-time totals + optional period breakdown.
 * Aligns headline counts with GET /api/admin/posts/all (same post row scope).
 */
exports.getAdminOverviewStats = async (req, res) => {
    try {
        const period = (req.query.period || '7d').toString();
        const startDate = adminDashboardPeriodStartDate(period);

        const [
            totalUsers,
            usersNewInPeriod,
            allTimePosts,
            periodPosts,
            viewEventsAllTime,
            viewEventsPeriod,
            engagementAllTime,
            engagementPeriod,
            pendingReviews,
            flaggedContents,
        ] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { createdAt: { gte: startDate } } }),
            computeAdminPostMetrics(null),
            computeAdminPostMetrics(startDate),
            prisma.view.count(),
            prisma.view.count({ where: { createdAt: { gte: startDate } } }),
            computeEngagementTotalsAllTime(),
            computeEngagementTotalsSince(startDate),
            prisma.post.count({ where: { status: 'draft' } }),
            prisma.post.count({ where: { status: 'suspended', is_frozen: true } }),
        ]);

        const engagementRatePeriod =
            periodPosts.totalPosts > 0
                ? Math.round((engagementPeriod.total / periodPosts.totalPosts) * 10000) / 100
                : 0;
        const engagementRateAllTime =
            allTimePosts.totalPosts > 0
                ? Math.round((engagementAllTime.total / allTimePosts.totalPosts) * 10000) / 100
                : 0;

        res.json({
            status: 'success',
            data: {
                generatedAt: new Date().toISOString(),
                period: { key: period, startDate: startDate.toISOString() },
                notes: [
                    'Legacy GET /admin/dashboard/stats field `stats.totalPosts` / `stats.totalVideos` are filtered by post createdAt inside the selected period only.',
                    'Use `allTime.posts` here for totals that should match GET /admin/posts/all totalCount (no status filter).',
                    '`viewEvents` counts rows in the `views` table; `sumPostViewsField` is SUM(posts.views) — product may use either.',
                ],
                allTime: {
                    users: { total: totalUsers },
                    posts: allTimePosts,
                    engagement: {
                        ...engagementAllTime,
                        engagementRatePercentVsPosts: engagementRateAllTime,
                    },
                    viewEvents: viewEventsAllTime,
                    sumPostViewsField: allTimePosts.sumPostViewsField,
                    moderation: {
                        pendingDrafts: pendingReviews,
                        suspendedAndFrozen: flaggedContents,
                    },
                },
                inPeriod: {
                    users: { newRegistrations: usersNewInPeriod },
                    posts: periodPosts,
                    engagement: {
                        ...engagementPeriod,
                        engagementRatePercentVsPosts: engagementRatePeriod,
                    },
                    viewEvents: viewEventsPeriod,
                },
            },
        });
    } catch (error) {
        console.error('Get admin overview stats error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching overview stats',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

/**
 * POST /api/admin/posts/upload-stale/fail
 * Marks old video posts stuck in processing_status=uploading with no video_url as failed (cleanup).
 */
exports.failStaleUploadingPosts = async (req, res) => {
    try {
        const dryRun = req.body && req.body.dryRun !== false;
        const olderThanMinutes = Math.min(
            10080,
            Math.max(15, parseInt(req.body?.olderThanMinutes ?? '720', 10))
        );
        const limit = Math.min(500, Math.max(1, parseInt(req.body?.limit ?? '200', 10)));
        const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

        const stale = await prisma.post.findMany({
            where: {
                type: 'video',
                processing_status: 'uploading',
                video_url: null,
                createdAt: { lt: cutoff },
            },
            select: { id: true, user_id: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });

        if (dryRun) {
            return res.json({
                status: 'success',
                data: {
                    dryRun: true,
                    olderThanMinutes,
                    matched: stale.length,
                    postIds: stale.map((p) => p.id),
                    message: 'Set body { "dryRun": false } to mark these posts as processing failed.',
                },
            });
        }

        const msg = `Upload abandoned or upload-complete never succeeded (policy: older than ${olderThanMinutes} minutes).`;
        await prisma.post.updateMany({
            where: { id: { in: stale.map((p) => p.id) } },
            data: {
                processing_status: 'failed',
                processing_error: msg.slice(0, 500),
            },
        });

        await invalidatePostCaches();

        res.json({
            status: 'success',
            data: {
                dryRun: false,
                olderThanMinutes,
                updatedCount: stale.length,
                postIds: stale.map((p) => p.id),
            },
        });
    } catch (error) {
        console.error('failStaleUploadingPosts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Stale upload cleanup failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

// Get comprehensive dashboard stats with date filtering
exports.getDashboardStats = async (req, res) => {
    try {
        const { period = '7d' } = req.query;
        const startDate = adminDashboardPeriodStartDate(period);

        const [
            totalUsers,
            pendingReviews,
            flaggedContents,
            periodPostMetrics,
            allTimePostMetrics,
            totalViews,
            totalViewEventsAllTime,
            totalEngagements,
            engagementAllTime,
            recentContent,
        ] = await Promise.all([
            prisma.user.count(),
            prisma.post.count({ where: { status: 'draft' } }),
            prisma.post.count({
                where: {
                    status: 'suspended',
                    is_frozen: true,
                },
            }),
            computeAdminPostMetrics(startDate),
            computeAdminPostMetrics(null),
            prisma.view.count({
                where: { createdAt: { gte: startDate } },
            }),
            prisma.view.count(),
            prisma.$queryRaw`
                SELECT 
                    (SELECT COUNT(*) FROM "post_likes" WHERE "createdAt" >= ${startDate}) +
                    (SELECT COUNT(*) FROM "comments" WHERE "comment_date" >= ${startDate}) +
                    (SELECT COUNT(*) FROM "shares" WHERE "createdAt" >= ${startDate}) as total_engagements
            `,
            computeEngagementTotalsAllTime(),
            prisma.post.findMany({
                take: 10,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            profile_picture: true,
                        },
                    },
                    category: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            }),
        ]);

        const totalEngagementsCount = totalEngagements[0]?.total_engagements
            ? Number(totalEngagements[0].total_engagements)
            : 0;

        const engagementRate =
            periodPostMetrics.totalPosts > 0
                ? (totalEngagementsCount / periodPostMetrics.totalPosts) * 100
                : 0;

        const engagementRateAllTime =
            allTimePostMetrics.totalPosts > 0
                ? (engagementAllTime.total / allTimePostMetrics.totalPosts) * 100
                : 0;

        res.json({
            status: 'success',
            data: {
                period,
                stats: {
                    totalUsers,
                    totalVideos: periodPostMetrics.videos.withPublicAsset,
                    pendingReviews,
                    flaggedContents,
                    totalViews,
                    totalPosts: periodPostMetrics.totalPosts,
                    totalEngagements: totalEngagementsCount,
                    engagementRate: Math.round(engagementRate * 100) / 100,
                },
                statsAllTime: {
                    totalUsers,
                    totalPosts: allTimePostMetrics.totalPosts,
                    totalVideos: allTimePostMetrics.videos.withPublicAsset,
                    totalVideosByType: allTimePostMetrics.videos.typeVideoCount,
                    videosUploading: allTimePostMetrics.videos.uploading,
                    totalViewEvents: totalViewEventsAllTime,
                    sumPostViewsField: allTimePostMetrics.sumPostViewsField,
                    totalEngagements: engagementAllTime.total,
                    engagementRate: Math.round(engagementRateAllTime * 100) / 100,
                    byStatus: allTimePostMetrics.byStatus,
                    pendingReviews,
                    flaggedContents,
                },
                statsLegend: {
                    legacyStatsScope:
                        'stats.totalPosts, stats.totalVideos, stats.totalViews, stats.totalEngagements are limited to posts/events created in the selected period.',
                    statsAllTimeScope:
                        'statsAllTime matches platform-wide post counts (same basis as GET /admin/posts/all without filters).',
                },
                recentContent,
            },
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching dashboard stats',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

// Get detailed analytics with user demographics and device usage
exports.getAnalytics = async (req, res) => {
    try {
        const { period = '7d' } = req.query;
        
        // Calculate date range
        const now = new Date();
        let startDate;
        
        switch (period) {
            case '1h':
                startDate = new Date(now.getTime() - 60 * 60 * 1000);
                break;
            case '1d':
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '1m':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '3m':
                startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case '1y':
                startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }

        const [
            totalUsers,
            totalViews,
            totalPosts,
            totalEngagements,
            userDemographics,
            deviceUsage,
            topCountries,
            topCategories,
            avgSessionTimes,
            bounceRate,
            completionRate
        ] = await Promise.all([
            // Total Users
            prisma.user.count({
                where: { createdAt: { gte: startDate } }
            }),
            
            // Total Views
            prisma.view.count({
                where: { createdAt: { gte: startDate } }
            }),
            
            // Total Posts
            prisma.post.count({
                where: { createdAt: { gte: startDate } }
            }),
            
            // Total Engagements
            prisma.$queryRaw`
                SELECT 
                    (SELECT COUNT(*) FROM "post_likes" WHERE "createdAt" >= ${startDate}) +
                    (SELECT COUNT(*) FROM "comments" WHERE "comment_date" >= ${startDate}) +
                    (SELECT COUNT(*) FROM "shares" WHERE "createdAt" >= ${startDate}) as total_engagements
            `,
            
            // User Demographics (age groups based on date_of_birth)
            prisma.$queryRaw`
                SELECT 
                    CASE 
                        WHEN "date_of_birth" IS NULL THEN 'Unknown'
                        WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) < 18 THEN 'Under 18'
                        WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 18 AND 24 THEN '18-24'
                        WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 25 AND 34 THEN '25-34'
                        WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 35 AND 44 THEN '35-44'
                        WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 45 AND 54 THEN '45-54'
                        WHEN EXTRACT(YEAR FROM AGE("date_of_birth")) BETWEEN 55 AND 64 THEN '55-64'
                        ELSE '65+'
                    END as age_group,
                    COUNT(*) as count
                FROM "users" 
                WHERE "createdAt" >= ${startDate}
                GROUP BY age_group
                ORDER BY count DESC
            `,
            
            // Device Usage (from user_agent in views)
            prisma.$queryRaw`
                SELECT 
                    CASE 
                        WHEN "user_agent" ILIKE '%mobile%' OR "user_agent" ILIKE '%android%' OR "user_agent" ILIKE '%iphone%' THEN 'Mobile'
                        WHEN "user_agent" ILIKE '%tablet%' OR "user_agent" ILIKE '%ipad%' THEN 'Tablet'
                        ELSE 'Desktop'
                    END as device_type,
                    COUNT(*) as count
                FROM "views" 
                WHERE "createdAt" >= ${startDate}
                GROUP BY device_type
                ORDER BY count DESC
            `,
            
            // Top Countries (User Distribution)
            prisma.$queryRaw`
                SELECT 
                    c.name as country,
                    c.flag_emoji,
                    COUNT(u.id) as user_count,
                    ROUND(COUNT(u.id) * 100.0 / (SELECT COUNT(*) FROM "users" WHERE "createdAt" >= ${startDate}), 2) as percentage
                FROM "users" u
                JOIN "countries" c ON u.country_id = c.id
                WHERE u."createdAt" >= ${startDate}
                GROUP BY c.id, c.name, c.flag_emoji
                ORDER BY user_count DESC
                LIMIT 10
            `,
            
            // Top Content Categories
            prisma.$queryRaw`
                SELECT 
                    cat.name as category,
                    COUNT(p.id) as post_count,
                    ROUND(COUNT(p.id) * 100.0 / (SELECT COUNT(*) FROM "posts" WHERE "createdAt" >= ${startDate}), 2) as percentage
                FROM "posts" p
                JOIN "categories" cat ON p.category_id = cat.id
                WHERE p."createdAt" >= ${startDate}
                GROUP BY cat.id, cat.name
                ORDER BY post_count DESC
                LIMIT 10
            `,
            
            // Average Session Times (calculated as time between first and last view per user)
            prisma.$queryRaw`
                SELECT 
                    AVG(session_duration) as avg_session_seconds
                FROM (
                    SELECT 
                        "user_id",
                        EXTRACT(EPOCH FROM (MAX("createdAt") - MIN("createdAt"))) as session_duration
                    FROM "views" 
                    WHERE "createdAt" >= ${startDate} AND "user_id" IS NOT NULL
                    GROUP BY "user_id"
                    HAVING COUNT(*) > 1
                ) user_sessions
            `,
            
            // Bounce Rate (users with only 1 view)
            prisma.$queryRaw`
                SELECT 
                    COUNT(*) as single_view_users,
                    (SELECT COUNT(DISTINCT "user_id") FROM "views" WHERE "createdAt" >= ${startDate} AND "user_id" IS NOT NULL) as total_users,
                    ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(DISTINCT "user_id") FROM "views" WHERE "createdAt" >= ${startDate} AND "user_id" IS NOT NULL), 0), 2) as bounce_rate
                FROM (
                    SELECT "user_id", COUNT(*) as view_count
                    FROM "views" 
                    WHERE "createdAt" >= ${startDate} AND "user_id" IS NOT NULL
                    GROUP BY "user_id"
                    HAVING COUNT(*) = 1
                ) single_view
            `,
            
            // Completion Rate (posts with high engagement)
            prisma.$queryRaw`
                SELECT 
                    COUNT(*) as high_engagement_posts,
                    (SELECT COUNT(*) FROM "posts" WHERE "createdAt" >= ${startDate}) as total_posts,
                    ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM "posts" WHERE "createdAt" >= ${startDate}), 0), 2) as completion_rate
                FROM "posts" p
                WHERE p."createdAt" >= ${startDate}
                AND (p.likes + p.comment_count + p.shares) >= 10
            `
        ]);

        // Convert BigInt values to numbers for JSON serialization
        const convertBigInt = (value) => {
            if (typeof value === 'bigint') {
                return Number(value);
            }
            if (value === null || value === undefined) {
                return value;
            }
            if (typeof value === 'object') {
                if (Array.isArray(value)) {
                    return value.map(convertBigInt);
                }
                const converted = {};
                for (const key in value) {
                    converted[key] = convertBigInt(value[key]);
                }
                return converted;
            }
            return value;
        };

        res.json({
            status: 'success',
            data: {
                period,
                analytics: {
                    totalUsers: Number(totalUsers),
                    totalViews: Number(totalViews),
                    totalPosts: Number(totalPosts),
                    totalEngagements: totalEngagements[0]?.total_engagements 
                        ? Number(totalEngagements[0].total_engagements) 
                        : 0,
                    userDemographics: convertBigInt(userDemographics),
                    deviceUsage: convertBigInt(deviceUsage),
                    topCountries: convertBigInt(topCountries),
                    topCategories: convertBigInt(topCategories),
                    avgSessionTimes: avgSessionTimes[0]?.avg_session_seconds 
                        ? Math.round(Number(avgSessionTimes[0].avg_session_seconds) / 60)
                        : 0,
                    bounceRate: bounceRate[0]?.bounce_rate 
                        ? Number(bounceRate[0].bounce_rate) 
                        : 0,
                    completionRate: completionRate[0]?.completion_rate 
                        ? Number(completionRate[0].completion_rate) 
                        : 0
                }
            }
        });

    } catch (error) {
        console.error('Get analytics error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching analytics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get content management dashboard stats
exports.getContentManagementStats = async (req, res) => {
    try {
        const [
            totalContents,
            videos,
            images,
            pendingReviews,
            flaggedContents,
            featuredContents,
            activeContents,
            suspendedContents,
            adsCount,
        ] = await Promise.all([
            prisma.post.count(),
            prisma.post.count({ where: { video_url: { not: null }, type: 'video' } }),
            prisma.post.count({ where: { video_url: { not: null }, type: 'image' } }),
            prisma.post.count({ where: { status: 'draft' } }),
            prisma.post.count({ where: { is_frozen: true } }),
            prisma.post.count({ where: { is_featured: true } }),
            prisma.post.count({ where: { status: 'active' } }),
            prisma.post.count({ where: { status: 'suspended' } }),
            prisma.post.count({ where: { is_ad: true } }),
        ]);

        res.json({
            status: 'success',
            data: {
                totalContents,
                videos,
                images,
                pendingReviews,
                flaggedContents,
                featuredContents,
                activeContents,
                suspendedContents,
                adsCount,
                notes: [
                    '`videos` counts type=video with video_url set (excludes stuck uploads with null video_url).',
                    'Use GET /api/admin/stats/overview for full breakdown including uploading/pending.',
                ],
            },
        });

    } catch (error) {
        console.error('Get content management stats error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching content management stats',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Set post as featured
exports.setPostFeatured = async (req, res) => {
    try {
        const { postId } = req.params;
        const { featured } = req.body;

        const post = await prisma.post.update({
            where: { id: postId },
            data: { is_featured: featured },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            }
        });
        await invalidatePostCaches();

        // Clear cache for all posts and featured posts
        const { clearCacheByPattern, CACHE_KEYS } = require('../utils/cache');
        await clearCacheByPattern(CACHE_KEYS.ALL_POSTS);
        await clearCacheByPattern(CACHE_KEYS.FEATURED_POSTS);

        // Log admin action
        loggers.audit('set_post_featured', {
            adminId: req.user.id,
            postId: postId,
            featured: featured
        });

        res.json({
            status: 'success',
            message: `Post ${featured ? 'featured' : 'unfeatured'} successfully`,
            data: { post }
        });

    } catch (error) {
        console.error('Set post featured error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error updating post featured status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Freeze a post
exports.freezePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { reason } = req.body;

        const post = await prisma.post.update({
            where: { id: postId },
            data: {
                is_frozen: true,
                status: 'suspended', // Use suspended status when freezing
                frozen_at: new Date()
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            }
        });
        await invalidatePostCaches();

        // Notify post owner
        await prisma.notification.create({
            data: {
                userID: post.user.username,
                message: `Your post has been frozen. Reason: ${reason || 'Policy violation'}`,
                type: 'post_frozen',
                isRead: false
            }
        });

        // Log admin action
        loggers.audit('freeze_post', {
            adminId: req.user.id,
            postId: postId,
            reason: reason
        });

        res.json({
            status: 'success',
            message: 'Post frozen successfully',
            data: { post }
        });

    } catch (error) {
        console.error('Freeze post error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error freezing post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Unfreeze a post
exports.unfreezePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { reason } = req.body;

        const post = await prisma.post.update({
            where: { id: postId },
            data: {
                is_frozen: false,
                status: 'active',
                frozen_at: null,
                report_count: 0 // Reset report count
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            }
        });
        await invalidatePostCaches();

        // Notify post owner
        await prisma.notification.create({
            data: {
                userID: post.user.username,
                message: `Your post has been unfrozen and is now visible again. ${reason ? 'Reason: ' + reason : ''}`,
                type: 'post_unfrozen',
                isRead: false
            }
        });

        // Log admin action
        loggers.audit('unfreeze_post', {
            adminId: req.user.id,
            postId: postId,
            reason: reason
        });

        res.json({
            status: 'success',
            message: 'Post unfrozen successfully',
            data: { post }
        });

    } catch (error) {
        console.error('Unfreeze post error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error unfreezing post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Suspend a post (admin) – set status to suspended, store reason and suspended_by, notify owner
exports.suspendPost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { reason } = req.body || {};

        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: {
                user: {
                    select: { id: true, username: true }
                }
            }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        const adminId = await getAdminId(req.user?.id, req.user?.role);
        await prisma.post.update({
            where: { id: postId },
            data: {
                status: 'suspended',
                is_frozen: true,
                frozen_at: new Date(),
                suspended_at: new Date(),
                suspension_reason: reason || null,
                suspended_by: adminId || null
            }
        });
        await invalidatePostCaches();

        if (post.user?.username) {
            const msg = `Your post "${post.title}" has been suspended.${reason ? ' Reason: ' + reason : ''} You can appeal this decision if you believe it's a mistake.`;
            await prisma.notification.create({
                data: {
                    userID: post.user.username,
                    message: msg,
                    type: 'post_suspended',
                    isRead: false
                }
            });
            emitEvent('notification:created', {
                userId: post.user.id,
                userID: post.user.username,
                notification: { type: 'post_suspended', message: msg }
            });
        }

        loggers.audit('admin_suspend_post', { adminId: req.user.id, postId, reason: reason || null });
        writeAuditLog({
            actionType: 'ADMIN_SUSPEND_POST',
            resourceType: 'post',
            resourceId: postId,
            actorAdminId: adminId || req.user?.id,
            details: { reason: reason || null },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Post suspended successfully',
            data: { postId }
        });
    } catch (error) {
        console.error('Suspend post error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error suspending post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete a post (admin) – permanent delete; optional reason in body for audit
exports.adminDeletePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { reason } = req.body || {};

        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: { id: true, user_id: true }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        await prisma.comment.deleteMany({ where: { post_id: postId } });
        await prisma.featuredPost.deleteMany({ where: { post_id: postId } });
        await prisma.challengePost.deleteMany({ where: { post_id: postId } });
        await prisma.share.deleteMany({ where: { post_id: postId } });
        await prisma.postReport.deleteMany({ where: { post_id: postId } });
        await prisma.postAppeal.deleteMany({ where: { post_id: postId } });
        await prisma.notification.updateMany({ where: { postId: postId }, data: { postId: null } });
        await prisma.post.delete({ where: { id: postId } });

        if (post.user_id) {
            await prisma.user.update({
                where: { id: post.user_id },
                data: { posts_count: { decrement: 1 } }
            });
        }

        const { clearCacheByPattern } = require('../utils/cache');
        await clearCacheByPattern('single_post');
        await clearCacheByPattern('all_posts');
        await clearCacheByPattern('following_posts');
        await clearCacheByPattern('featured_posts');
        await clearCacheByPattern('search_posts');
        await clearCacheByPattern('feed:');

        loggers.audit('admin_delete_post', { adminId: req.user.id, postId, reason: reason || null });
        const deletePostAdminId = await getAdminId(req.user?.id, req.user?.role);
        writeAuditLog({
            actionType: 'ADMIN_DELETE_POST',
            resourceType: 'post',
            resourceId: postId,
            actorAdminId: deletePostAdminId || req.user?.id,
            details: { reason: reason || null, ownerUserId: post.user_id },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Post deleted successfully',
            data: { postId }
        });
    } catch (error) {
        console.error('Admin delete post error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error deleting post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get single post by ID with full detail for admin (likers, commenters, reports, appeals, activity)
exports.getAdminPostById = async (req, res) => {
    try {
        const { postId } = req.params;

        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        email: true,
                        profile_picture: true,
                        bio: true,
                        status: true,
                        follower_count: true,
                        posts_count: true,
                        createdAt: true,
                        country: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                                flag_emoji: true
                            }
                        }
                    }
                },
                category: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        level: true,
                        parent: { select: { id: true, name: true } }
                    }
                },
                _count: {
                    select: {
                        postLikes: true,
                        comments: true,
                        postViews: true,
                        postShares: true,
                        reports: true,
                        appeals: true
                    }
                },
                postLikes: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                display_name: true,
                                profile_picture: true,
                                createdAt: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                },
                comments: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                display_name: true,
                                profile_picture: true
                            }
                        }
                    },
                    orderBy: { comment_date: 'desc' }
                },
                reports: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                display_name: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                },
                appeals: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                display_name: true
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                },
                challengePosts: {
                    select: {
                        id: true,
                        submitted_at: true,
                        likes_at_challenge_end: true,
                        challenge: {
                            select: {
                                id: true,
                                name: true,
                                status: true,
                                start_date: true,
                                end_date: true
                            }
                        }
                    }
                }
            }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        // Build activity timeline: recent likes and comments merged by date (for admin "post activity over the past")
        const likeActivities = (post.postLikes || []).map(like => ({
            type: 'like',
            id: like.id,
            createdAt: like.createdAt,
            user: like.user
        }));
        const commentActivities = (post.comments || []).map(c => ({
            type: 'comment',
            id: c.id,
            createdAt: c.comment_date,
            comment_text: c.comment_text,
            user: c.user
        }));
        const activity = [...likeActivities, ...commentActivities]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 100);

        const response = {
            ...post,
            likers: (post.postLikes || []).map(like => ({
                id: like.user?.id,
                username: like.user?.username,
                display_name: like.user?.display_name,
                profile_picture: like.user?.profile_picture,
                liked_at: like.createdAt
            })),
            commenters: (post.comments || []).map(c => ({
                id: c.user?.id,
                username: c.user?.username,
                display_name: c.user?.display_name,
                profile_picture: c.user?.profile_picture,
                comment_text: c.comment_text,
                comment_date: c.comment_date
            })),
            activity
        };

        res.json({
            status: 'success',
            data: response
        });
    } catch (error) {
        console.error('Get admin post by ID error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get posts currently waiting for or in processing (system health / pipeline)
exports.getPostsProcessing = async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

        const posts = await prisma.post.findMany({
            where: {
                type: 'video',
                processing_status: {
                    in: ['pending', 'processing', 'uploading']
                }
            },
            select: {
                id: true,
                title: true,
                status: true,
                type: true,
                processing_status: true,
                processing_error: true,
                uploadDate: true,
                createdAt: true,
                user_id: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: limitNum
        });

        const counts = await prisma.post.groupBy({
            by: ['processing_status'],
            where: {
                type: 'video',
                processing_status: { in: ['pending', 'processing', 'uploading'] }
            },
            _count: { id: true }
        });

        const countByStatus = counts.reduce((acc, c) => {
            acc[c.processing_status || 'unknown'] = c._count.id;
            return acc;
        }, {});

        res.json({
            status: 'success',
            data: {
                posts,
                total: posts.length,
                summary: {
                    pending: countByStatus.pending || 0,
                    processing: countByStatus.processing || 0,
                    uploading: countByStatus.uploading || 0,
                    totalInPipeline: (countByStatus.pending || 0) + (countByStatus.processing || 0) + (countByStatus.uploading || 0)
                }
            }
        });
    } catch (error) {
        console.error('Get posts processing error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching processing posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * HEAD-check public CDN for HLS output already present (processor finished but callback missed DB update).
 * @param {string} postId
 * @returns {Promise<string|null>} hls_url if a playlist is reachable
 */
async function findReachableHlsUrlForPost(postId) {
    const base = (R2_PUBLIC_DOMAIN || 'https://media.talentix.net').replace(/\/$/, '');
    const candidates = [
        `${base}/hls/${postId}/master.m3u8`,
        `${base}/hls/${postId}/720p/playlist.m3u8`,
        `${base}/hls/${postId}/360p/playlist.m3u8`,
    ];
    for (const url of candidates) {
        try {
            const r = await axios.head(url, {
                timeout: 15000,
                maxRedirects: 5,
                validateStatus: (s) => s === 200 || s === 204,
            });
            if (r.status === 200 || r.status === 204) return url;
        } catch {
            /* try next */
        }
    }
    return null;
}

/**
 * POST /admin/posts/processing/reconcile-from-cdn
 * Body: { dryRun?: boolean (default true), limit?: number (max 200) }
 * Updates posts stuck in pending/processing when HLS files already exist on the public CDN.
 */
exports.reconcileVideoPostsFromCdn = async (req, res) => {
    try {
        const dryRun = req.body && req.body.dryRun !== false;
        const limit = Math.min(200, Math.max(1, parseInt(req.body?.limit, 10) || 50));

        const posts = await prisma.post.findMany({
            where: {
                type: 'video',
                processing_status: { in: ['pending', 'processing'] },
                video_url: { not: null },
            },
            select: { id: true, processing_status: true },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });

        const updated = [];
        const preview = [];

        for (const p of posts) {
            const hlsUrl = await findReachableHlsUrlForPost(p.id);
            if (!hlsUrl) continue;

            preview.push({ postId: p.id, hlsUrl, previousStatus: p.processing_status });

            if (!dryRun) {
                await prisma.post.update({
                    where: { id: p.id },
                    data: {
                        processing_status: 'completed',
                        hls_url: hlsUrl,
                        processing_error: null,
                    },
                });
                updated.push(p.id);
            }
        }

        if (!dryRun && updated.length > 0) {
            try {
                await clearCacheByPattern('all_posts');
                await clearCacheByPattern('single_post');
                await clearCacheByPattern('search_posts');
                await clearCacheByPattern('following_posts');
                await clearCacheByPattern('feed:');
            } catch (e) {
                console.warn('[Admin] reconcileVideoPostsFromCdn cache clear:', e.message);
            }
        }

        const ts = new Date().toISOString();
        console.log(`[Admin] ${ts} reconcileVideoPostsFromCdn`, { dryRun, scanned: posts.length, matched: preview.length, updated: updated.length });

        res.json({
            status: 'success',
            data: {
                dryRun,
                scanned: posts.length,
                matched: preview.length,
                updatedIds: dryRun ? [] : updated,
                preview: preview.slice(0, 100),
                message: dryRun
                    ? 'Dry run only. Set body { "dryRun": false } to apply updates.'
                    : `Updated ${updated.length} post(s) to completed using existing CDN HLS.`,
            },
        });
    } catch (error) {
        console.error('reconcileVideoPostsFromCdn error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Reconcile failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

/**
 * POST /admin/posts/processing/requeue-stuck
 * Body: { dryRun?: boolean (default true), limit?: number (max 100) }
 * Re-enqueues video jobs for pending/processing posts that have video_url but no reachable HLS on CDN yet.
 * Does not apply to processing_status=uploading (no raw file yet — client must finish upload).
 */
exports.bulkRequeueStuckVideoJobs = async (req, res) => {
    try {
        const dryRun = req.body && req.body.dryRun !== false;
        const limit = Math.min(100, Math.max(1, parseInt(req.body?.limit, 10) || 30));

        const { addVideoJob } = require('../queues/videoQueue');

        const posts = await prisma.post.findMany({
            where: {
                type: 'video',
                processing_status: { in: ['pending', 'processing'] },
                video_url: { not: null },
            },
            select: { id: true, video_url: true, processing_status: true },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });

        const enqueued = [];
        const skipped = [];
        const errors = [];

        for (const p of posts) {
            const existingHls = await findReachableHlsUrlForPost(p.id);
            if (existingHls) {
                skipped.push({ postId: p.id, reason: 'hls_already_on_cdn_use_reconcile' });
                continue;
            }

            if (dryRun) {
                enqueued.push({ postId: p.id, wouldEnqueue: true });
                continue;
            }

            try {
                await prisma.post.update({
                    where: { id: p.id },
                    data: { processing_status: 'pending', processing_error: null },
                });
                const job = await addVideoJob(p.id, p.video_url);
                enqueued.push({ postId: p.id, jobId: job?.id });
            } catch (e) {
                const msg = e?.message || String(e);
                errors.push({ postId: p.id, error: msg.slice(0, 200) });
                try {
                    await prisma.post.update({
                        where: { id: p.id },
                        data: { processing_status: 'failed', processing_error: msg.slice(0, 500) },
                    });
                } catch {
                    /* ignore */
                }
            }
        }

        const ts = new Date().toISOString();
        console.log(`[Admin] ${ts} bulkRequeueStuckVideoJobs`, { dryRun, scanned: posts.length, enqueued: enqueued.length, skipped: skipped.length, errors: errors.length });

        res.json({
            status: 'success',
            data: {
                dryRun,
                scanned: posts.length,
                enqueued: dryRun ? enqueued : enqueued.filter((x) => x.jobId),
                skippedHlsAlreadyOnCdn: skipped,
                errors,
                message: dryRun
                    ? 'Dry run. Set { "dryRun": false } to enqueue jobs.'
                    : `Enqueued ${enqueued.length} job(s). Skipped ${skipped.length} (run reconcile-from-cdn first). Errors: ${errors.length}.`,
            },
        });
    } catch (error) {
        console.error('bulkRequeueStuckVideoJobs error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Bulk requeue failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

// Get post reports and reporters (full reporter info, reason, description, status, timestamps)
exports.getPostReports = async (req, res) => {
    try {
        const { postId } = req.params;

        const reports = await prisma.postReport.findMany({
            where: { post_id: postId },
            select: {
                id: true,
                post_id: true,
                reason: true,
                description: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                reviewed_by: true,
                reviewed_at: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        email: true,
                        profile_picture: true,
                        bio: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            status: 'success',
            data: { reports }
        });

    } catch (error) {
        console.error('Get post reports error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching post reports',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all appeals
exports.getAllAppeals = async (req, res) => {
    try {
        const { page = 1, limit = 10, status } = req.query;
        const offset = (page - 1) * limit;

        const whereClause = {};
        if (status) whereClause.status = status;

        const [appeals, totalCount] = await Promise.all([
            prisma.postAppeal.findMany({
                where: whereClause,
                include: {
                    post: {
                        select: {
                            id: true,
                            title: true,
                            status: true,
                            report_count: true,
                            frozen_at: true
                        }
                    },
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    reviewer: {
                        select: {
                            id: true,
                            username: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.postAppeal.count({ where: whereClause })
        ]);

        res.json({
            status: 'success',
            data: {
                appeals,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get all appeals error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching appeals',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Send broadcast notification to all users
exports.sendBroadcastNotification = async (req, res) => {
    try {
        const { title, message, type = 'broadcast' } = req.body;

        if (!title || !message) {
            return res.status(400).json({
                status: 'error',
                message: 'Title and message are required'
            });
        }

        // Get all active users with username (required for Notification.userID FK)
        const users = await prisma.user.findMany({
            where: { status: 'active', username: { not: null } },
            select: { id: true, username: true }
        });

        // Create notifications for all users
        const notifications = users.map(user => ({
            userID: user.username,
            message: `${title}: ${message}`,
            type: type,
            isRead: false,
            createdAt: new Date(),
            updatedAt: new Date()
        }));

        await prisma.notification.createMany({
            data: notifications
        });

        const fullMessage = `${title}: ${message}`;
        // Emit real-time notification events to each active user (no fetch needed; payload matches created rows)
        for (const user of users) {
            emitEvent('notification:created', {
                userId: user.id,
                userID: user.username,
                notification: {
                    type,
                    message: fullMessage,
                    isRead: false,
                    createdAt: new Date()
                }
            });
        }

        // Log admin action
        loggers.audit('broadcast_notification', {
            adminId: req.user.id,
            title: title,
            message: message,
            recipientCount: users.length
        });
        const adminId = await getAdminId(req.user?.id, req.user?.role);
        writeAuditLog({
            actionType: 'ADMIN_BROADCAST_NOTIFICATION',
            actorAdminId: adminId || req.user?.id,
            details: { title, message, recipientCount: users.length, type },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: `Broadcast notification sent to ${users.length} users`,
            data: {
                recipientCount: users.length,
                title,
                message
            }
        });

    } catch (error) {
        console.error('Send broadcast notification error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error sending broadcast notification',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Send a notification to a single user (admin)
exports.sendNotificationToUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { message, type = 'admin_message' } = req.body;

        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'message is required and must be a non-empty string'
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true }
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        if (!user.username) {
            return res.status(400).json({
                status: 'error',
                message: 'User has no username; cannot send notification (notifications are linked by username)'
            });
        }

        const notification = await prisma.notification.create({
            data: {
                userID: user.username,
                message: message.trim(),
                type: type.trim() || 'admin_message',
                isRead: false
            }
        });

        emitEvent('notification:created', {
            userId: user.id,
            userID: user.username,
            notification: {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                isRead: notification.isRead,
                createdAt: notification.createdAt
            }
        });

        loggers.audit('admin_send_notification', {
            adminId: req.user.id,
            targetUserId: userId,
            type: notification.type
        });

        res.json({
            status: 'success',
            message: 'Notification sent to user',
            data: {
                notificationId: notification.id,
                userId: user.id,
                type: notification.type
            }
        });
    } catch (error) {
        console.error('Send notification to user error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error sending notification to user',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all posts with full detail for admin (list view with everything needed for moderation). Optional q/search for aggressive multi-field search.
exports.getAdminAllPosts = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, sort = 'newest', q, search } = req.query;
        const searchQ = normalizeQuery(q) ?? normalizeQuery(search);
        const postWhere = buildPostSearchWhere(searchQ ?? '', {
            status: status && status !== 'all' ? status : undefined
        });
        const whereClause = Object.keys(postWhere).length > 0 ? postWhere : (status && status !== 'all' ? { status } : {});

        const { pageNum, limitNum, offset } = parsePagination(page, limit, { maxLimit: 100 });

        let orderBy = {};
        switch (sort) {
            case 'oldest':
                orderBy = { createdAt: 'asc' };
                break;
            case 'most_liked':
                orderBy = [{ likes: 'desc' }, { createdAt: 'desc' }];
                break;
            case 'most_viewed':
                orderBy = [{ views: 'desc' }, { createdAt: 'desc' }];
                break;
            case 'most_reported':
                orderBy = [{ report_count: 'desc' }, { createdAt: 'desc' }];
                break;
            case 'newest':
            default:
                orderBy = { createdAt: 'desc' };
        }

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            display_name: true,
                            email: true,
                            profile_picture: true,
                            bio: true,
                            status: true,
                            follower_count: true,
                            posts_count: true,
                            createdAt: true,
                            country: {
                                select: {
                                    id: true,
                                    name: true,
                                    code: true,
                                    flag_emoji: true
                                }
                            }
                        }
                    },
                    category: {
                        select: {
                            id: true,
                            name: true,
                            description: true,
                            level: true,
                            parent_id: true,
                            parent: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    },
                    _count: {
                        select: {
                            postLikes: true,
                            comments: true,
                            postViews: true,
                            postShares: true,
                            reports: true,
                            appeals: true
                        }
                    },
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true,
                                    display_name: true
                                }
                            }
                        },
                        orderBy: { createdAt: 'desc' },
                        take: 10
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true,
                                    display_name: true
                                }
                            }
                        },
                        orderBy: { createdAt: 'desc' },
                        take: 5
                    },
                    challengePosts: {
                        select: {
                            id: true,
                            submitted_at: true,
                            likes_at_challenge_end: true,
                            challenge: {
                                select: {
                                    id: true,
                                    name: true,
                                    status: true,
                                    end_date: true
                                }
                            }
                        }
                    }
                },
                orderBy,
                take: limitNum,
                skip: offset
            }),
            prisma.post.count({ where: whereClause })
        ]);

        const postsWithMeta = posts.map(post => {
            const totalEngagements = (post.likes || 0) + (post.comment_count || 0) + (post.shares || 0);
            const engagementRate = post.views > 0 ? (totalEngagements / post.views) * 100 : 0;
            return {
                ...post,
                analytics: {
                    totalEngagements,
                    engagementRate: Math.round(engagementRate * 100) / 100,
                    isHighReport: (post._count?.reports || 0) >= 3,
                    hasAppeals: (post._count?.appeals || 0) > 0
                }
            };
        });

        res.json({
            status: 'success',
            data: {
                posts: postsWithMeta,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalCount,
                    totalPages: Math.ceil(totalCount / limitNum),
                    hasNext: offset + limitNum < totalCount,
                    hasPrev: pageNum > 1
                },
                filters: {
                    status: status || 'all',
                    sort: sort || 'newest'
                }
            }
        });
    } catch (error) {
        console.error('Get admin all posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get detailed posts with analytics for admin
exports.getAdminPosts = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, sort = 'newest' } = req.query;
        const offset = (page - 1) * limit;

        const whereClause = {};
        if (status && status !== 'all') {
            whereClause.status = status;
        }

        let orderBy = {};
        switch (sort) {
            case 'newest':
                orderBy = { createdAt: 'desc' };
                break;
            case 'oldest':
                orderBy = { createdAt: 'asc' };
                break;
            case 'most_liked':
                orderBy = { likes: 'desc' };
                break;
            case 'most_viewed':
                orderBy = { views: 'desc' };
                break;
            case 'most_reported':
                orderBy = { report_count: 'desc' };
                break;
            default:
                orderBy = { createdAt: 'desc' };
        }

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                            profile_picture: true,
                            bio: true,
                            country: {
                                select: {
                                    name: true,
                                    flag_emoji: true
                                }
                            }
                        }
                    },
                    category: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    _count: {
                        select: {
                            postLikes: true,
                            postViews: true,
                            comments: true,
                            shares: true,
                            reports: true
                        }
                    },
                    reports: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: { createdAt: 'desc' },
                        take: 5
                    },
                    appeals: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true
                                }
                            }
                        },
                        orderBy: { createdAt: 'desc' }
                    }
                },
                orderBy,
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({ where: whereClause })
        ]);

        // Calculate engagement metrics for each post
        const postsWithAnalytics = posts.map(post => {
            const totalEngagements = post._count.postLikes + post._count.comments + post._count.shares;
            const engagementRate = post.views > 0 ? (totalEngagements / post.views) * 100 : 0;
            
            return {
                ...post,
                viewCount: post.views, // Explicit view count
                viewCountFromTable: post._count.postViews, // View count from views table
                analytics: {
                    totalEngagements,
                    engagementRate: Math.round(engagementRate * 100) / 100,
                    avgEngagementPerView: post.views > 0 ? Math.round((totalEngagements / post.views) * 100) / 100 : 0,
                    isHighPerforming: totalEngagements >= 50,
                    isControversial: post._count.reports >= 3,
                    riskScore: Math.min(100, (post._count.reports * 20) + (post.is_frozen ? 50 : 0))
                }
            };
        });

        res.json({
            status: 'success',
            data: {
                posts: postsWithAnalytics,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                },
                filters: {
                    status,
                    sort
                }
            }
        });

    } catch (error) {
        console.error('Get admin posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching admin posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===== CHALLENGE MANAGEMENT =====

// Get all challenge requests (pending, approved, rejected, active, ended). Optional q/search for aggressive multi-field search.
exports.getAllChallenges = async (req, res) => {
    try {
        const { status, page = 1, limit = 20, q, search } = req.query;
        const searchQ = normalizeQuery(q) ?? normalizeQuery(search);
        const challengeWhere = buildChallengeSearchWhere(searchQ ?? '', { status });
        const where = Object.keys(challengeWhere).length > 0 ? challengeWhere : (status ? { status } : {});

        const { pageNum, limitNum, offset } = parsePagination(page, limit, { maxLimit: 100 });

        const [challenges, total] = await Promise.all([
            prisma.challenge.findMany({
                where,
                skip: offset,
                take: limitNum,
                orderBy: { createdAt: 'desc' },
                include: {
                    organizer: {
                        select: {
                            id: true,
                            username: true,
                            display_name: true,
                            email: true,
                            profile_picture: true
                        }
                    },
                    approver: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    },
                    _count: {
                        select: {
                            participants: true,
                            posts: true
                        }
                    }
                }
            }),
            prisma.challenge.count({ where })
        ]);

        res.json({
            status: 'success',
            data: challenges,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        console.error('Error fetching challenges:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get pending challenge requests
exports.getPendingChallenges = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [challenges, total] = await Promise.all([
            prisma.challenge.findMany({
                where: { status: 'pending' },
                skip,
                take: parseInt(limit),
                orderBy: {
                    createdAt: 'desc'
                },
                include: {
                    organizer: {
                        select: {
                            id: true,
                            username: true,
                            display_name: true,
                            email: true,
                            profile_picture: true
                        }
                    },
                    _count: {
                        select: {
                            participants: true,
                            posts: true
                        }
                    }
                }
            }),
            prisma.challenge.count({ where: { status: 'pending' } })
        ]);

        res.json({
            status: 'success',
            data: challenges,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching pending challenges:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch pending challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get a single challenge by ID
exports.getChallengeById = async (req, res) => {
    try {
        const { challengeId } = req.params;

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        email: true,
                        profile_picture: true
                    }
                },
                approver: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                },
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                display_name: true,
                                profile_picture: true,
                                posts_count: true,
                                follower_count: true
                            }
                        }
                    },
                    orderBy: {
                        joined_at: 'desc'
                    }
                },
                posts: {
                    include: {
                        post: {
                            include: {
                                user: {
                                    select: {
                                        id: true,
                                        username: true,
                                        display_name: true,
                                        profile_picture: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        submitted_at: 'desc'
                    }
                },
                _count: {
                    select: {
                        participants: true,
                        posts: true
                    }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        // For ended challenges, order posts by winner_rank (asc, nulls last), then likes_at_challenge_end desc, then submitted_at desc (same as public winners list)
        const isEnded = challenge.status === 'ended' || challenge.status === 'stopped';
        const posts = isEnded
            ? [...challenge.posts].sort((a, b) => {
                const rankA = a.winner_rank ?? Infinity;
                const rankB = b.winner_rank ?? Infinity;
                if (rankA !== rankB) return rankA - rankB;
                const likesA = a.likes_at_challenge_end ?? 0;
                const likesB = b.likes_at_challenge_end ?? 0;
                if (likesB !== likesA) return likesB - likesA;
                return new Date(b.submitted_at) - new Date(a.submitted_at);
            })
            : challenge.posts;

        // Get post counts for each participant
        const participantsWithPostCounts = await Promise.all(
            challenge.participants.map(async (participant) => {
                const postCount = await prisma.challengePost.count({
                    where: {
                        challenge_id: challengeId,
                        user_id: participant.user_id
                    }
                });

                return {
                    ...participant,
                    post_count: postCount
                };
            })
        );

        // Get basic statistics
        const totalParticipants = challenge._count.participants;
        const totalPosts = challenge._count.posts;
        const participantsWithPosts = participantsWithPostCounts.filter(p => p.post_count > 0).length;
        const participantsWithoutPosts = totalParticipants - participantsWithPosts;
        const averagePostsPerParticipant = totalParticipants > 0 
            ? Math.round((totalPosts / totalParticipants) * 100) / 100 
            : 0;

        // Get recent activity (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const [recentParticipants, recentPosts] = await Promise.all([
            prisma.challengeParticipant.count({
                where: {
                    challenge_id: challengeId,
                    joined_at: {
                        gte: sevenDaysAgo
                    }
                }
            }),
            prisma.challengePost.count({
                where: {
                    challenge_id: challengeId,
                    submitted_at: {
                        gte: sevenDaysAgo
                    }
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                ...challenge,
                posts,
                participants: participantsWithPostCounts,
                statistics: {
                    total_participants: totalParticipants,
                    total_posts: totalPosts,
                    participants_with_posts: participantsWithPosts,
                    participants_without_posts: participantsWithoutPosts,
                    average_posts_per_participant: averagePostsPerParticipant,
                    recent_activity: {
                        participants_last_7_days: recentParticipants,
                        posts_last_7_days: recentPosts
                    }
                },
                // Note: For detailed analytics and growth graphs, use GET /admin/challenges/:challengeId/analytics
                analytics_endpoint: `/admin/challenges/${challengeId}/analytics`
            }
        });
    } catch (error) {
        console.error('Error fetching challenge:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Approve a challenge
exports.approveChallenge = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;

        // Get Admin ID - handles both Admin records and Users with admin role
        const adminId = await getAdminId(userId, userRole);

        if (!adminId) {
            return res.status(403).json({
                status: 'error',
                message: 'Admin ID could not be resolved'
            });
        }

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status !== 'pending') {
            return res.status(400).json({
                status: 'error',
                message: `Challenge is already ${challenge.status}`
            });
        }

        // Update challenge status to approved and set it to active
        const now = new Date();
        const startDate = new Date(challenge.start_date);
        const endDate = new Date(challenge.end_date);
        
        // Determine if challenge should be active (if start date has passed)
        const shouldBeActive = now >= startDate && now <= endDate;

        const updatedChallenge = await prisma.challenge.update({
            where: { id: challengeId },
            data: {
                status: shouldBeActive ? 'active' : 'approved',
                approved_by: adminId,
                approved_at: now
            },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                },
                approver: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                }
            }
        });

        // Notify organizer
        const notification = await prisma.notification.create({
            data: {
                userID: challenge.organizer.username,
                message: `Your challenge "${challenge.name}" has been approved and is now ${shouldBeActive ? 'active' : 'approved'}.`,
                type: 'challenge_approved',
                isRead: false,
                challengeId: challenge.id  // Challenge that was approved
            }
        });

        // Emit real-time notification event
        const { emitEvent } = require('../lib/realtime');
        emitEvent('notification:created', {
            userId: challenge.organizer.id,
            userID: challenge.organizer.username,
            notification: {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                isRead: notification.isRead,
                createdAt: notification.createdAt,
                metadata: {
                    challengeId: challenge.id,
                    challengeName: challenge.name
                }
            }
        });

        // Log admin action
        loggers.audit('approve_challenge', {
            adminId: adminId,
            challengeId: challengeId,
            challengeName: challenge.name
        });
        writeAuditLog({
            actionType: 'ADMIN_APPROVE_CHALLENGE',
            resourceType: 'challenge',
            resourceId: challengeId,
            actorAdminId: adminId,
            details: { challengeName: challenge.name },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Challenge approved successfully',
            data: updatedChallenge
        });
    } catch (error) {
        console.error('Error approving challenge:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to approve challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/** PUT /admin/challenges/:challengeId/start-now — mark approved challenge as active immediately (live until end_date). */
exports.startChallengeNow = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const adminId = await getAdminId(req.user.id, req.user.role);
        if (!adminId) {
            return res.status(403).json({
                status: 'error',
                message: 'Admin ID could not be resolved'
            });
        }

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                organizer: {
                    select: { id: true, username: true, email: true }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status === 'active') {
            return res.json({
                status: 'success',
                message: 'Challenge is already active',
                data: challenge
            });
        }

        if (challenge.status !== 'approved') {
            return res.status(400).json({
                status: 'error',
                message: `Cannot start challenge with status "${challenge.status}". Only approved challenges can be started now.`
            });
        }

        const updatedChallenge = await prisma.challenge.update({
            where: { id: challengeId },
            data: { status: 'active' },
            include: {
                organizer: {
                    select: { id: true, username: true, email: true }
                }
            }
        });

        const notification = await prisma.notification.create({
            data: {
                userID: challenge.organizer.username,
                message: `Your challenge "${challenge.name}" is now live.`,
                type: 'challenge_live',
                isRead: false,
                challengeId: challenge.id
            }
        });

        emitEvent('notification:created', {
            userId: challenge.organizer.id,
            userID: challenge.organizer.username,
            notification: {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                isRead: notification.isRead,
                createdAt: notification.createdAt,
                metadata: {
                    challengeId: challenge.id,
                    challengeName: challenge.name
                }
            }
        });

        try {
            const { clearCacheByPattern } = require('../utils/cache');
            await clearCacheByPattern('challenge:');
            await clearCacheByPattern('challenge_participants_ranking');
        } catch (cacheErr) {
            console.warn('Failed to clear challenge caches after start-now:', cacheErr);
        }

        emitEvent('challenge:updated', {
            challengeId,
            action: 'start_now',
            status: updatedChallenge.status,
            start_date: updatedChallenge.start_date,
            end_date: updatedChallenge.end_date
        });

        loggers.audit('challenge_start_now', {
            adminId,
            challengeId,
            challengeName: challenge.name
        });
        writeAuditLog({
            actionType: 'ADMIN_CHALLENGE_START_NOW',
            resourceType: 'challenge',
            resourceId: challengeId,
            actorAdminId: adminId,
            details: { challengeName: challenge.name },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Challenge is now live',
            data: updatedChallenge
        });
    } catch (error) {
        console.error('Error starting challenge now:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to start challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/** PUT /admin/challenges/:challengeId/dates — update start/end (ISO); may end challenge if end_date <= now. */
exports.updateChallengeDates = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { start_date: bodyStart, end_date: bodyEnd } = req.body || {};
        const adminId = await getAdminId(req.user.id, req.user.role);
        if (!adminId) {
            return res.status(403).json({
                status: 'error',
                message: 'Admin ID could not be resolved'
            });
        }

        if (bodyStart === undefined && bodyEnd === undefined) {
            return res.status(400).json({
                status: 'error',
                message: 'At least one of start_date or end_date is required (ISO 8601 strings).'
            });
        }

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                organizer: {
                    select: { id: true, username: true, email: true }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status !== 'approved' && challenge.status !== 'active') {
            return res.status(400).json({
                status: 'error',
                message: `Challenge schedule can only be edited when status is approved or active (current: ${challenge.status}).`
            });
        }

        let nextStart = new Date(challenge.start_date);
        let nextEnd = new Date(challenge.end_date);

        if (bodyStart !== undefined) {
            if (typeof bodyStart !== 'string') {
                return res.status(400).json({
                    status: 'error',
                    message: 'start_date must be an ISO 8601 string'
                });
            }
            const d = new Date(bodyStart);
            if (Number.isNaN(d.getTime())) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid start_date'
                });
            }
            nextStart = d;
        }

        if (bodyEnd !== undefined) {
            if (typeof bodyEnd !== 'string') {
                return res.status(400).json({
                    status: 'error',
                    message: 'end_date must be an ISO 8601 string'
                });
            }
            const d = new Date(bodyEnd);
            if (Number.isNaN(d.getTime())) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid end_date'
                });
            }
            nextEnd = d;
        }

        if (nextEnd <= nextStart) {
            return res.status(400).json({
                status: 'error',
                message: 'end_date must be after start_date'
            });
        }

        const now = new Date();
        const newStatus = nextEnd <= now ? 'ended' : challenge.status;
        const data = {
            start_date: nextStart,
            end_date: nextEnd
        };
        if (newStatus !== challenge.status) {
            data.status = newStatus;
        }

        const updatedChallenge = await prisma.challenge.update({
            where: { id: challengeId },
            data,
            include: {
                organizer: {
                    select: { id: true, username: true, email: true }
                }
            }
        });

        const becameEnded = newStatus === 'ended' && challenge.status !== 'ended';
        if (becameEnded) {
            const { snapshotLikesAtChallengeEnd, assignInitialWinnerRanks } = require('./challengeController');
            await snapshotLikesAtChallengeEnd(challengeId);
            await assignInitialWinnerRanks(challengeId);

            const orgEndedNotif = await prisma.notification.create({
                data: {
                    userID: challenge.organizer.username,
                    message: `Your challenge "${challenge.name}" has ended (schedule was updated by an administrator).`,
                    type: 'challenge_ended',
                    isRead: false,
                    challengeId: challenge.id
                }
            });
            emitEvent('notification:created', {
                userId: challenge.organizer.id,
                userID: challenge.organizer.username,
                notification: {
                    id: orgEndedNotif.id,
                    type: orgEndedNotif.type,
                    message: orgEndedNotif.message,
                    isRead: orgEndedNotif.isRead,
                    createdAt: orgEndedNotif.createdAt,
                    metadata: {
                        challengeId: challenge.id,
                        challengeName: challenge.name
                    }
                }
            });

            const participants = await prisma.challengeParticipant.findMany({
                where: { challenge_id: challengeId },
                include: {
                    user: { select: { id: true, username: true } }
                }
            });
            for (const participant of participants) {
                if (!participant.user?.username) continue;
                const pNotif = await prisma.notification.create({
                    data: {
                        userID: participant.user.username,
                        message: `The challenge "${challenge.name}" has ended.`,
                        type: 'challenge_ended',
                        isRead: false,
                        challengeId: challenge.id
                    }
                });
                if (participant.user.id) {
                    emitEvent('notification:created', {
                        userId: participant.user.id,
                        userID: participant.user.username,
                        notification: {
                            id: pNotif.id,
                            type: pNotif.type,
                            message: pNotif.message,
                            isRead: pNotif.isRead,
                            createdAt: pNotif.createdAt,
                            metadata: {
                                challengeId: challenge.id,
                                challengeName: challenge.name
                            }
                        }
                    });
                }
            }
        } else {
            const scheduleNotif = await prisma.notification.create({
                data: {
                    userID: challenge.organizer.username,
                    message: `The schedule for "${challenge.name}" was updated by an administrator.`,
                    type: 'challenge_schedule_updated',
                    isRead: false,
                    challengeId: challenge.id
                }
            });
            emitEvent('notification:created', {
                userId: challenge.organizer.id,
                userID: challenge.organizer.username,
                notification: {
                    id: scheduleNotif.id,
                    type: scheduleNotif.type,
                    message: scheduleNotif.message,
                    isRead: scheduleNotif.isRead,
                    createdAt: scheduleNotif.createdAt,
                    metadata: {
                        challengeId: challenge.id,
                        challengeName: challenge.name
                    }
                }
            });
        }

        try {
            const { clearCacheByPattern } = require('../utils/cache');
            await clearCacheByPattern('challenge:');
            await clearCacheByPattern('challenge_participants_ranking');
        } catch (cacheErr) {
            console.warn('Failed to clear challenge caches after dates update:', cacheErr);
        }

        emitEvent('challenge:updated', {
            challengeId,
            action: 'dates_updated',
            status: updatedChallenge.status,
            start_date: updatedChallenge.start_date,
            end_date: updatedChallenge.end_date
        });

        loggers.audit('challenge_dates_updated', {
            adminId,
            challengeId,
            challengeName: challenge.name,
            start_date: nextStart.toISOString(),
            end_date: nextEnd.toISOString()
        });
        writeAuditLog({
            actionType: 'ADMIN_CHALLENGE_DATES_UPDATED',
            resourceType: 'challenge',
            resourceId: challengeId,
            actorAdminId: adminId,
            details: {
                challengeName: challenge.name,
                start_date: nextStart.toISOString(),
                end_date: nextEnd.toISOString(),
                previous_status: challenge.status,
                new_status: updatedChallenge.status
            },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Challenge dates updated',
            data: updatedChallenge
        });
    } catch (error) {
        console.error('Error updating challenge dates:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update challenge dates',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Reject a challenge
exports.rejectChallenge = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role;

        // Get Admin ID - check if user is Admin or User with admin role
        let adminId = null;
        
        if (userRole === 'admin') {
            // Check if it's an Admin record
            const admin = await prisma.admin.findUnique({
                where: { id: userId }
            });
            
            if (admin) {
                adminId = admin.id;
            } else {
                // User with admin role - find or create Admin record
                const user = await prisma.user.findUnique({
                    where: { id: userId },
                    select: { username: true, email: true }
                });
                
                if (user) {
                    // Try to find Admin by username or email
                    let adminRecord = await prisma.admin.findFirst({
                        where: {
                            OR: [
                                { username: user.username },
                                { email: user.email }
                            ]
                        }
                    });
                    
                    // If no Admin record exists, create one
                    if (!adminRecord) {
                        adminRecord = await prisma.admin.create({
                            data: {
                                username: user.username || `admin_${userId.substring(0, 8)}`,
                                email: user.email || `admin_${userId}@talynk.com`,
                                password: '', // Password not needed for existing user
                                status: 'active'
                            }
                        });
                    }
                    
                    adminId = adminRecord.id;
                }
            }
        }

        if (!adminId) {
            return res.status(403).json({
                status: 'error',
                message: 'Admin ID could not be resolved'
            });
        }

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status !== 'pending') {
            return res.status(400).json({
                status: 'error',
                message: `Challenge is already ${challenge.status}`
            });
        }

        const updatedChallenge = await prisma.challenge.update({
            where: { id: challengeId },
            data: {
                status: 'rejected',
                rejection_reason: reason || null
            }
        });

        // Notify organizer
        const notification = await prisma.notification.create({
            data: {
                userID: challenge.organizer.username,
                message: `Your challenge "${challenge.name}" has been rejected.${reason ? ' Reason: ' + reason : ''}`,
                type: 'challenge_rejected',
                isRead: false,
                challengeId: challenge.id  // Challenge that was rejected
            }
        });

        // Emit real-time notification event
        const { emitEvent } = require('../lib/realtime');
        emitEvent('notification:created', {
            userId: challenge.organizer.id,
            userID: challenge.organizer.username,
            notification: {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                isRead: notification.isRead,
                createdAt: notification.createdAt,
                metadata: {
                    challengeId: challenge.id,
                    challengeName: challenge.name,
                    reason: reason || null
                }
            }
        });

        // Log admin action
        loggers.audit('reject_challenge', {
            adminId: adminId,
            challengeId: challengeId,
            challengeName: challenge.name,
            reason: reason
        });
        writeAuditLog({
            actionType: 'ADMIN_REJECT_CHALLENGE',
            resourceType: 'challenge',
            resourceId: challengeId,
            actorAdminId: adminId,
            details: { challengeName: challenge.name, reason: reason || null },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Challenge rejected successfully',
            data: updatedChallenge
        });
    } catch (error) {
        console.error('Error rejecting challenge:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to reject challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Confirm winners for an ended/stopped challenge (admin only)
// After confirmation, winners become visible in mobile/public APIs.
exports.confirmChallengeWinners = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;

        const adminId = await getAdminId(userId, userRole);
        if (!adminId) {
            return res.status(403).json({
                status: 'error',
                message: 'Admin ID could not be resolved'
            });
        }

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                notification: true
                            }
                        }
                    }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status !== 'ended' && challenge.status !== 'stopped') {
            return res.status(400).json({
                status: 'error',
                message: 'Only ended or stopped challenges can have winners confirmed'
            });
        }

        if (challenge.winners_confirmed_at) {
            return res.status(400).json({
                status: 'error',
                message: 'Winners are already confirmed for this challenge'
            });
        }

        const winnersCount = await prisma.challengePost.count({
            where: { challenge_id: challengeId }
        });

        if (winnersCount === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No challenge posts found to confirm winners'
            });
        }

        const winnersConfig = await challengeController.resolveChallengeWinnersConfig(challengeId);
        if (!winnersConfig || winnersConfig.participant_count <= 0 || winnersConfig.effective_max_winners <= 0) {
            return res.status(400).json({
                status: 'error',
                code: 'NO_ELIGIBLE_WINNERS',
                message: 'No eligible winners can be confirmed because this challenge has no participants.',
                data: winnersConfig || undefined
            });
        }

        let rankedWinnersCount = await prisma.challengePost.count({
            where: {
                challenge_id: challengeId,
                winner_rank: {
                    lte: winnersConfig.effective_max_winners
                }
            }
        });
        // Backward compatibility: if no ranks were set yet, derive initial top-N ranks once.
        if (rankedWinnersCount === 0) {
            await challengeController.assignInitialWinnerRanks(challengeId);
            rankedWinnersCount = await prisma.challengePost.count({
                where: {
                    challenge_id: challengeId,
                    winner_rank: {
                        lte: winnersConfig.effective_max_winners
                    }
                }
            });
        }
        if (rankedWinnersCount < winnersConfig.effective_max_winners) {
            return res.status(400).json({
                status: 'error',
                code: 'INCOMPLETE_WINNER_RANKING',
                message: 'Winner ranking is incomplete for the configured number of winners. Reorder winners or reduce max winners before confirming.',
                data: {
                    ...winnersConfig,
                    ranked_winners_count: rankedWinnersCount
                }
            });
        }

        const now = new Date();
        const updatedChallenge = await prisma.challenge.update({
            where: { id: challengeId },
            data: {
                winners_confirmed_at: now,
                winners_confirmed_by: adminId
            }
        });

        // Notify all participants that winners have been announced
        const notifications = [];
        for (const participant of challenge.participants) {
            const participantUser = participant.user;
            if (!participantUser || !participantUser.username || !participantUser.notification) continue;

            const notification = await prisma.notification.create({
                data: {
                    userID: participantUser.username,
                    message: `Winners for "${challenge.name}" have been announced.`,
                    type: 'challenge_winners_announced',
                    isRead: false,
                    challengeId: challenge.id
                }
            });

            notifications.push({
                db: notification,
                user: participantUser
            });
        }

        // Emit real-time notifications to participants
        for (const item of notifications) {
            const { db: notification, user } = item;
            emitEvent('notification:created', {
                userId: user.id,
                userID: user.username,
                notification: {
                    id: notification.id,
                    type: notification.type,
                    message: notification.message,
                    isRead: notification.isRead,
                    createdAt: notification.createdAt,
                    metadata: {
                        challengeId: challenge.id,
                        challengeName: challenge.name
                    }
                }
            });
        }

        // Clear any challenge-related caches and emit winners-confirmed event
        try {
            const { clearCacheByPattern } = require('../utils/cache');
            await clearCacheByPattern(`challenge:${challengeId}`);
            await clearCacheByPattern('challenge_participants_ranking');
            await clearCacheByPattern('challenge_winners');
        } catch (cacheErr) {
            console.warn('Failed to clear challenge caches after winners confirmation:', cacheErr);
        }

        emitEvent('challenge:winnersConfirmed', {
            challengeId,
            winnersConfirmedAt: updatedChallenge.winners_confirmed_at
        });

        // Log admin action
        loggers.audit('confirm_challenge_winners', {
            adminId,
            challengeId,
            challengeName: challenge.name
        });
        writeAuditLog({
            actionType: 'ADMIN_CONFIRM_CHALLENGE_WINNERS',
            resourceType: 'challenge',
            resourceId: challengeId,
            actorAdminId: adminId,
            details: { challengeName: challenge.name },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Challenge winners confirmed successfully',
            data: updatedChallenge
        });
    } catch (error) {
        console.error('Error confirming challenge winners:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to confirm challenge winners',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Stop/End a challenge (admin only)
exports.stopChallenge = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const adminId = req.user.id;

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                organizer: {
                    select: {
                        username: true,
                        email: true
                    }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status === 'ended' || challenge.status === 'stopped') {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge is already ended or stopped'
            });
        }

        if (challenge.status !== 'active' && challenge.status !== 'approved') {
            return res.status(400).json({
                status: 'error',
                message: 'Only active or approved challenges can be stopped'
            });
        }

        const updatedChallenge = await prisma.challenge.update({
            where: { id: challengeId },
            data: {
                status: 'stopped'
            }
        });

        // Snapshot like counts for each challenge post (for ranking and transparency after challenge ends)
        const { snapshotLikesAtChallengeEnd, assignInitialWinnerRanks } = require('./challengeController');
        await snapshotLikesAtChallengeEnd(challengeId);
        await assignInitialWinnerRanks(challengeId);

        // Notify organizer
        await prisma.notification.create({
            data: {
                userID: challenge.organizer.username,
                message: `Your challenge "${challenge.name}" has been ended by an administrator.`,
                type: 'challenge_ended',
                isRead: false
            }
        });

        // Notify all participants
        const participants = await prisma.challengeParticipant.findMany({
            where: { challenge_id: challengeId },
            include: {
                user: {
                    select: {
                        username: true
                    }
                }
            }
        });

        for (const participant of participants) {
            await prisma.notification.create({
                data: {
                    userID: participant.user.username,
                    message: `The challenge "${challenge.name}" has been ended.`,
                    type: 'challenge_ended',
                    isRead: false
                }
            });
        }

        // Log admin action
        loggers.audit('stop_challenge', {
            adminId: adminId,
            challengeId: challengeId,
            challengeName: challenge.name
        });
        writeAuditLog({
            actionType: 'ADMIN_STOP_CHALLENGE',
            resourceType: 'challenge',
            resourceId: challengeId,
            actorAdminId: adminId,
            details: { challengeName: challenge.name },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Challenge stopped successfully',
            data: updatedChallenge
        });
    } catch (error) {
        console.error('Error stopping challenge:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to stop challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Reorder challenge winners (admin only). Only for ended challenges. Body: { orderedChallengePostIds: string[] }.
exports.reorderChallengeWinners = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { orderedChallengePostIds } = req.body || {};

        if (!Array.isArray(orderedChallengePostIds)) {
            return res.status(400).json({
                status: 'error',
                message: 'orderedChallengePostIds must be an array of challenge post IDs'
            });
        }

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status !== 'ended') {
            return res.status(400).json({
                status: 'error',
                message: 'Only ended challenges can have winners reordered'
            });
        }

        const uniqueIds = [...new Set(orderedChallengePostIds)];
        if (uniqueIds.length !== orderedChallengePostIds.length) {
            return res.status(400).json({
                status: 'error',
                message: 'orderedChallengePostIds must not contain duplicates'
            });
        }

        if (uniqueIds.length === 0) {
            await prisma.challengePost.updateMany({
                where: { challenge_id: challengeId },
                data: { winner_rank: null }
            });
            return res.json({
                status: 'success',
                message: 'Winner ranks cleared',
                data: { orderedChallengePostIds: [] }
            });
        }

        const winnersConfig = await challengeController.resolveChallengeWinnersConfig(challengeId);
        const effectiveMaxWinners = winnersConfig?.effective_max_winners ?? 0;
        if (uniqueIds.length > effectiveMaxWinners) {
            return res.status(400).json({
                status: 'error',
                code: 'MAX_WINNERS_EXCEEDED',
                message: 'Provided winner list exceeds the maximum winners allowed for this challenge.',
                data: {
                    submitted_winners_count: uniqueIds.length,
                    ...winnersConfig
                }
            });
        }

        const found = await prisma.challengePost.findMany({
            where: {
                id: { in: uniqueIds },
                challenge_id: challengeId
            },
            select: { id: true }
        });

        if (found.length !== uniqueIds.length) {
            return res.status(400).json({
                status: 'error',
                message: 'All provided IDs must be challenge post IDs belonging to this challenge'
            });
        }

        await prisma.$transaction(async (tx) => {
            await tx.challengePost.updateMany({
                where: { challenge_id: challengeId },
                data: { winner_rank: null }
            });
            for (let i = 0; i < orderedChallengePostIds.length; i++) {
                await tx.challengePost.update({
                    where: { id: orderedChallengePostIds[i] },
                    data: { winner_rank: i + 1 }
                });
            }
        });

        const updated = await prisma.challengePost.findMany({
            where: { challenge_id: challengeId },
            orderBy: [{ winner_rank: 'asc' }, { likes_at_challenge_end: 'desc' }, { submitted_at: 'desc' }],
            select: { id: true, winner_rank: true, likes_at_challenge_end: true, submitted_at: true }
        });

        const adminId = await getAdminId(req.user?.id, req.user?.role);
        writeAuditLog({
            actionType: 'ADMIN_REORDER_CHALLENGE_WINNERS',
            resourceType: 'challenge',
            resourceId: challengeId,
            actorAdminId: adminId || req.user?.id,
            details: { orderedChallengePostIds },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Challenge winners reordered successfully',
            data: { orderedChallengePostIds, winners: updated }
        });
    } catch (error) {
        console.error('Error reordering challenge winners:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to reorder challenge winners',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Aggregated winners per user (admin). One row per user with totals and min winner_rank.
exports.getAggregatedChallengeWinners = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const pageNumber = parseInt(page);
        const pageLimit = parseInt(limit);
        const offset = (pageNumber - 1) * pageLimit;

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status === 'pending' || challenge.status === 'rejected') {
            return res.status(400).json({
                status: 'error',
                message: 'Only approved/active/ended/stopped challenges have winners'
            });
        }

        const challengePosts = await prisma.challengePost.findMany({
            where: { challenge_id: challengeId },
            orderBy: [
                { winner_rank: 'asc' },
                { likes_at_challenge_end: 'desc' },
                { submitted_at: 'desc' }
            ],
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true,
                        follower_count: true,
                        posts_count: true
                    }
                },
                post: {
                    select: {
                        id: true,
                        likes: true,
                        createdAt: true,
                        video_url: true,
                        hls_url: true,
                        thumbnail_url: true,
                        type: true,
                        title: true,
                        description: true
                    }
                }
            }
        });

        const byUser = new Map();
        for (const cp of challengePosts) {
            const key = cp.user_id;
            if (!byUser.has(key)) {
                byUser.set(key, {
                    user_id: cp.user_id,
                    user: cp.user,
                    total_winner_posts: 0,
                    total_likes_during_challenge: 0,
                    winner_rank: cp.winner_rank ?? null,
                    latest_submission_at: cp.submitted_at,
                    posts: []
                });
            }
            const agg = byUser.get(key);
            agg.total_winner_posts += 1;
            const likesDuring = cp.likes_at_challenge_end ?? 0;
            agg.total_likes_during_challenge += likesDuring;
            if (cp.winner_rank != null) {
                if (agg.winner_rank == null || cp.winner_rank < agg.winner_rank) {
                    agg.winner_rank = cp.winner_rank;
                }
            }
            if (new Date(cp.submitted_at) > new Date(agg.latest_submission_at)) {
                agg.latest_submission_at = cp.submitted_at;
            }
            agg.posts.push({
                challenge_post_id: cp.id,
                post_id: cp.post?.id,
                likes_during_challenge: likesDuring,
                total_likes: cp.post?.likes ?? 0,
                winner_rank: cp.winner_rank ?? null,
                submitted_at: cp.submitted_at
            });
        }

        let aggregated = Array.from(byUser.values());

        // Sort: when admin has set winner_rank on posts, use min winner_rank per user (asc, nulls last). Otherwise default to total likes per user (desc). Tie-break: total likes, then latest submission.
        const hasAdminRank = aggregated.some(a => a.winner_rank != null);
        aggregated.sort((a, b) => {
            if (hasAdminRank) {
                const rankA = a.winner_rank ?? Infinity;
                const rankB = b.winner_rank ?? Infinity;
                if (rankA !== rankB) return rankA - rankB;
            }
            if (b.total_likes_during_challenge !== a.total_likes_during_challenge) {
                return b.total_likes_during_challenge - a.total_likes_during_challenge;
            }
            return new Date(b.latest_submission_at) - new Date(a.latest_submission_at);
        });

        const total = aggregated.length;
        const pageItems = aggregated.slice(offset, offset + pageLimit);

        const participantCount = await prisma.challengeParticipant.count({
            where: { challenge_id: challengeId }
        });
        const configuredMaxWinners = challenge.max_winners ?? 10;
        const maxWinners = Math.min(configuredMaxWinners, participantCount);

        res.json({
            status: 'success',
            data: pageItems,
            pagination: {
                page: pageNumber,
                limit: pageLimit,
                total,
                pages: Math.ceil(total / pageLimit)
            },
            winners_confirmed_at: challenge.winners_confirmed_at ?? null,
            ordered_by: hasAdminRank ? 'admin_rank' : 'total_likes_per_user',
            max_winners: maxWinners
        });
    } catch (error) {
        console.error('Error fetching aggregated challenge winners (admin):', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch aggregated challenge winners',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update challenge winners configuration (e.g. max_winners) and recompute ordering metadata
exports.updateChallengeWinnersConfig = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { maxWinners } = req.body;

        const existing = await prisma.challenge.findUnique({
            where: { id: challengeId },
            select: { id: true, max_winners: true }
        });
        if (!existing) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        const parsedMax = maxWinners != null ? parseInt(maxWinners, 10) : null;
        if (parsedMax != null && (Number.isNaN(parsedMax) || parsedMax <= 0)) {
            return res.status(400).json({
                status: 'error',
                message: 'maxWinners must be a positive integer'
            });
        }

        const participantCount = await prisma.challengeParticipant.count({
            where: { challenge_id: challengeId }
        });

        const updateData = parsedMax != null ? { max_winners: parsedMax } : {};
        if (Object.keys(updateData).length === 0) {
            const configuredMax = existing.max_winners != null && existing.max_winners > 0 ? existing.max_winners : 10;
            return res.json({
                status: 'success',
                message: 'No changes applied',
                data: {
                    challengeId,
                    max_winners: existing.max_winners != null && existing.max_winners > 0
                        ? existing.max_winners
                        : Math.min(10, participantCount)
                }
            });
        }

        const challenge = await prisma.challenge.update({
            where: { id: challengeId },
            data: updateData
        });

        writeAuditLog({
            actionType: 'CHALLENGE_WINNERS_CONFIG_UPDATED',
            actorAdminId: await getAdminId(req.user.id, req.user.role),
            resourceType: 'challenge',
            resourceId: challengeId,
            details: { max_winners: parsedMax },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Challenge winners configuration updated successfully',
            data: {
                challengeId,
                max_winners: challenge.max_winners ?? Math.min(10, participantCount)
            }
        });
    } catch (error) {
        console.error('Error updating challenge winners config:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update challenge winners configuration'
        });
    }
};

// Participants ranking for admin – delegates to public ranking implementation for shared behavior.
exports.getChallengeParticipantsRanking = async (req, res) => {
    try {
        return await challengeController.getChallengeParticipantsRanking(req, res);
    } catch (error) {
        console.error('Error fetching challenge participants ranking (admin):', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenge participants ranking',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ---------------------------------------------------------------------------
// Ads (admin-only; posts with is_ad=true, same video pipeline as normal posts)
// Signed-URL flow (recommended): create-upload -> client uploads to URL -> upload-complete.
// ---------------------------------------------------------------------------

const AD_UPLOAD_SESSION_TTL = 600; // 10 minutes
const AD_UPLOAD_SESSION_PREFIX = 'upload:'; // same as posts; postId is unique

/**
 * Create ad upload session - returns signed URL for direct client upload to R2 (same as mobile app).
 * POST /api/admin/ads/create-upload
 * Body: { title?, description? }
 * Client uploads video via PUT to uploadUrl, then calls upload-complete with postId.
 */
exports.createAdUpload = async (req, res) => {
    try {
        const adminId = await getAdminId(req.user.id, req.user.role);
        if (!adminId) {
            return res.status(403).json({ status: 'error', message: 'Admin ID could not be resolved' });
        }

        const { getSignedUploadUrl, isR2Configured } = require('../services/r2Storage');
        const { getClient: getRedisClient } = require('../lib/redis');
        const { v4: uuidv4 } = require('uuid');

        if (!isR2Configured()) {
            return res.status(503).json({
                status: 'error',
                message: 'Direct upload not available. R2 storage is not configured.',
            });
        }

        const redis = getRedisClient();
        if (!redis) {
            return res.status(503).json({
                status: 'error',
                message: 'Direct upload not available. Redis is not configured.',
            });
        }

        const title = (req.body.title || 'Ad').trim().slice(0, 255);
        const description = (req.body.description || '').trim() || null;
        const mimeTypeRaw = (req.body.mimeType || req.body.contentType || 'video/mp4').toString();
        const mimeType = mimeTypeRaw.toLowerCase();

        const isStaticImage = mimeType.startsWith('image/') && mimeType !== 'image/gif';
        const postType = isStaticImage ? 'image' : 'video';
        const initialProcessingStatus = postType === 'video' ? 'uploading' : null;

        const post = await prisma.post.create({
            data: {
                user_id: null,
                admin_id: adminId,
                status: 'active',
                type: postType,
                is_ad: true,
                title: title || 'Ad',
                description,
                content: description,
                video_url: null,
                thumbnail_url: null,
                processing_status: initialProcessingStatus,
                uploadDate: new Date(),
            },
        });

        const fileExt = isStaticImage ? '.jpg' : '.mp4';
        const fileName = `${Date.now()}-${uuidv4()}${fileExt}`;
        const r2Key = `media/ads/${fileName}`;

        const { uploadUrl, publicUrl } = await getSignedUploadUrl(r2Key, mimeType, AD_UPLOAD_SESSION_TTL);
        await redis.setex(`${AD_UPLOAD_SESSION_PREFIX}${post.id}`, AD_UPLOAD_SESSION_TTL, r2Key);

        loggers.audit('create_ad_upload_session', { adminId, adId: post.id, title: post.title });
        writeAuditLog({
            actionType: 'ADMIN_CREATE_AD_UPLOAD',
            resourceType: 'ad',
            resourceId: post.id,
            actorAdminId: adminId,
            details: { title: post.title },
            req,
        }).catch(() => {});

        res.status(201).json({
            status: 'success',
            data: {
                postId: post.id,
                uploadUrl,
                videoUrl: publicUrl,
                expiresIn: AD_UPLOAD_SESSION_TTL,
            },
        });
    } catch (error) {
        console.error('Error creating ad upload session:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create ad upload session',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Complete ad upload - verify file in R2, update post, queue video processing.
 * POST /api/admin/ads/upload-complete
 * Body: { postId }
 */
exports.completeAdUpload = async (req, res) => {
    try {
        const adminId = await getAdminId(req.user.id, req.user.role);
        if (!adminId) {
            return res.status(403).json({ status: 'error', message: 'Admin ID could not be resolved' });
        }

        const { postId } = req.body;
        if (!postId) {
            return res.status(400).json({ status: 'error', message: 'postId is required' });
        }

        const { getClient: getRedisClient } = require('../lib/redis');
        const { fileExistsInR2, R2_PUBLIC_DOMAIN } = require('../services/r2Storage');
        const { addVideoJob } = require('../queues/videoQueue');

        const redis = getRedisClient();
        if (!redis) {
            return res.status(503).json({
                status: 'error',
                message: 'Redis not configured',
            });
        }

        const post = await prisma.post.findFirst({
            where: { id: postId, is_ad: true },
        });

        if (!post) {
            return res.status(404).json({ status: 'error', message: 'Ad not found' });
        }
        if (post.type === 'video' && post.processing_status !== 'uploading') {
            return res.status(400).json({
                status: 'error',
                message: 'Ad is not in uploading state',
                processing_status: post.processing_status,
            });
        }

        const r2Key = await redis.get(`${AD_UPLOAD_SESSION_PREFIX}${postId}`);
        await redis.del(`${AD_UPLOAD_SESSION_PREFIX}${postId}`);

        if (!r2Key) {
            return res.status(400).json({
                status: 'error',
                message: 'Upload session expired or invalid. Please start a new upload.',
            });
        }

        const exists = await fileExistsInR2(r2Key);
        if (!exists) {
            return res.status(400).json({
                status: 'error',
                message: 'Video file not found in storage. Please complete the upload first.',
            });
        }

        const publicVideoUrl = `${R2_PUBLIC_DOMAIN}/${r2Key}`;

        if (post.type === 'video') {
            await prisma.post.update({
                where: { id: postId },
                data: {
                    video_url: publicVideoUrl,
                    processing_status: 'pending',
                },
            });

            try {
                await addVideoJob(postId, publicVideoUrl);
            } catch (queueErr) {
                const errMsg = queueErr?.message || 'Failed to queue video for processing';
                await prisma.post.update({
                    where: { id: postId },
                    data: { processing_status: 'failed', processing_error: errMsg.slice(0, 500) }
                });
                return res.status(500).json({
                    status: 'error',
                    message: 'Upload complete but processing queue failed. Ad left in failed state; you can retry from ads list.',
                    data: { postId }
                });
            }
        } else {
            // Static image ad: no video processing pipeline required.
            await prisma.post.update({
                where: { id: postId },
                data: {
                    video_url: publicVideoUrl,
                    processing_status: null
                },
            });
        }

        const { clearCacheByPattern, CACHE_KEYS } = require('../utils/cache');
        await clearCacheByPattern(CACHE_KEYS.ALL_POSTS);

        loggers.audit('complete_ad_upload', { adminId, adId: postId });
        writeAuditLog({
            actionType: 'ADMIN_COMPLETE_AD_UPLOAD',
            resourceType: 'ad',
            resourceId: postId,
            actorAdminId: adminId,
            details: {},
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: post.type === 'video'
                ? 'Upload complete. Video is being processed.'
                : 'Upload complete. Image ad is ready.',
            data: {
                postId,
                video_url: publicVideoUrl,
                processing_status: post.type === 'video' ? 'pending' : null,
            },
        });
    } catch (error) {
        console.error('Error completing ad upload:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to complete ad upload',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/** Legacy: create ad with multipart file (server handles upload). Prefer create-upload + upload-complete for FE. */
exports.createAd = async (req, res) => {
    try {
        const adminId = await getAdminId(req.user.id, req.user.role);
        if (!adminId) {
            return res.status(403).json({ status: 'error', message: 'Admin ID could not be resolved' });
        }
        if (!req.file) {
            return res.status(400).json({
                status: 'error',
                message: 'Media file is required',
                details: 'Upload an image or video file with the field name "file".'
            });
        }
        const video_url = req.file.r2Url || req.file.localUrl || req.file.supabaseUrl || '';
        if (!video_url || !video_url.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Media upload failed',
                details: 'The file upload was not successful.'
            });
        }
        const mimetype = req.file.mimetype || '';
        const isVideo = mimetype.startsWith('video/') || mimetype === 'image/gif';
        const isImage = mimetype.startsWith('image/') && mimetype !== 'image/gif';
        if (!isVideo && !isImage) {
            return res.status(400).json({
                status: 'error',
                message: 'Only image and video files are allowed for ads.'
            });
        }
        const title = (req.body.title || 'Ad').trim().slice(0, 255);
        const description = (req.body.description || '').trim() || null;

        const postType = isImage ? 'image' : 'video';
        const initialProcessingStatus = postType === 'video' ? 'pending' : null;

        const post = await prisma.post.create({
            data: {
                user_id: null,
                admin_id: adminId,
                status: 'active',
                type: postType,
                is_ad: true,
                title: title || 'Ad',
                description,
                content: description,
                video_url,
                thumbnail_url: null,
                processing_status: initialProcessingStatus,
                uploadDate: new Date()
            }
        });

        if (postType === 'video') {
            const { addVideoJob } = require('../queues/videoQueue');
            try {
                await addVideoJob(post.id, video_url);
            } catch (queueErr) {
                const errMsg = queueErr?.message || 'Failed to queue video for processing';
                await prisma.post.update({
                    where: { id: post.id },
                    data: { processing_status: 'failed', processing_error: errMsg.slice(0, 500) }
                });
                return res.status(500).json({
                    status: 'error',
                    message: 'Ad created but processing queue failed. You can retry from ads list.',
                    data: { id: post.id }
                });
            }
        }

        const { clearCacheByPattern, CACHE_KEYS } = require('../utils/cache');
        await clearCacheByPattern(CACHE_KEYS.ALL_POSTS);

        loggers.audit('create_ad', { adminId, adId: post.id, title: post.title });
        writeAuditLog({
            actionType: 'ADMIN_CREATE_AD',
            resourceType: 'ad',
            resourceId: post.id,
            actorAdminId: adminId,
            details: { title: post.title },
            req,
        }).catch(() => {});

        res.status(201).json({
            status: 'success',
            message: postType === 'video'
                ? 'Ad created. Video is being processed.'
                : 'Image ad created successfully.',
            data: {
                id: post.id,
                title: post.title,
                description: post.description,
                processing_status: post.processing_status,
                video_url: post.video_url
            }
        });
    } catch (error) {
        console.error('Error creating ad:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create ad',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.listAds = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const skip = (page - 1) * limit;

        const [ads, total] = await Promise.all([
            prisma.post.findMany({
                where: { is_ad: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: {
                    admin: { select: { id: true, username: true, email: true } }
                }
            }),
            prisma.post.count({ where: { is_ad: true } })
        ]);

        res.json({
            status: 'success',
            data: {
                ads,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Error listing ads:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to list ads',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getAdById = async (req, res) => {
    try {
        const { adId } = req.params;
        const ad = await prisma.post.findFirst({
            where: { id: adId, is_ad: true },
            include: {
                admin: { select: { id: true, username: true, email: true } }
            }
        });
        if (!ad) {
            return res.status(404).json({
                status: 'error',
                message: 'Ad not found'
            });
        }
        const { withVideoPlaybackUrl } = require('../utils/postVideoUtils');
        const withUrl = withVideoPlaybackUrl(ad);
        res.json({
            status: 'success',
            data: { ...withUrl, isAd: true }
        });
    } catch (error) {
        console.error('Error getting ad:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get ad',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.updateAd = async (req, res) => {
    try {
        const { adId } = req.params;
        const { title, description, status: bodyStatus } = req.body;

        const ad = await prisma.post.findFirst({
            where: { id: adId, is_ad: true }
        });
        if (!ad) {
            return res.status(404).json({
                status: 'error',
                message: 'Ad not found'
            });
        }

        const data = {};
        if (title !== undefined) data.title = String(title).trim().slice(0, 255) || ad.title;
        if (description !== undefined) data.description = String(description).trim() || null;
        if (description !== undefined) data.content = data.description;
        if (bodyStatus !== undefined && ['active', 'suspended'].includes(bodyStatus)) {
            data.status = bodyStatus;
        }

        const updated = await prisma.post.update({
            where: { id: adId },
            data
        });

        const { clearCacheByPattern, CACHE_KEYS } = require('../utils/cache');
        await clearCacheByPattern(CACHE_KEYS.ALL_POSTS);

        const adminId = await getAdminId(req.user?.id, req.user?.role);
        writeAuditLog({
            actionType: 'ADMIN_UPDATE_AD',
            resourceType: 'ad',
            resourceId: adId,
            actorAdminId: adminId || req.user?.id,
            details: { title: updated.title, status: updated.status },
            req,
        }).catch(() => {});

        res.json({
            status: 'success',
            message: 'Ad updated successfully',
            data: updated
        });
    } catch (error) {
        console.error('Error updating ad:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update ad',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.deleteAd = async (req, res) => {
    try {
        const { adId } = req.params;
        const ad = await prisma.post.findFirst({
            where: { id: adId, is_ad: true }
        });
        if (!ad) {
            return res.status(404).json({
                status: 'error',
                message: 'Ad not found'
            });
        }
        await prisma.post.delete({
            where: { id: adId }
        });
        const { clearCacheByPattern, CACHE_KEYS } = require('../utils/cache');
        await clearCacheByPattern(CACHE_KEYS.ALL_POSTS);
        loggers.audit('delete_ad', { adminId: req.user?.id, adId });
        const adminId = await getAdminId(req.user?.id, req.user?.role);
        writeAuditLog({
            actionType: 'ADMIN_DELETE_AD',
            resourceType: 'ad',
            resourceId: adId,
            actorAdminId: adminId || req.user?.id,
            details: {},
            req,
        }).catch(() => {});
        res.json({
            status: 'success',
            message: 'Ad deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting ad:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete ad',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get challenge dashboard statistics
exports.getChallengeDashboardStats = async (req, res) => {
    try {
        const [
            totalChallenges,
            pendingChallenges,
            approvedChallenges,
            activeChallenges,
            rejectedChallenges,
            endedChallenges,
            totalParticipants,
            totalPosts,
            challengesWithRewards,
            recentChallenges
        ] = await Promise.all([
            prisma.challenge.count(),
            prisma.challenge.count({ where: { status: 'pending' } }),
            prisma.challenge.count({ where: { status: 'approved' } }),
            prisma.challenge.count({ where: { status: 'active' } }),
            prisma.challenge.count({ where: { status: 'rejected' } }),
            prisma.challenge.count({ where: { status: 'ended' } }),
            prisma.challengeParticipant.count(),
            prisma.challengePost.count(),
            prisma.challenge.count({ where: { has_rewards: true } }),
            prisma.challenge.findMany({
                take: 10,
                orderBy: { createdAt: 'desc' },
                include: {
                    organizer: {
                        select: {
                            id: true,
                            username: true,
                            display_name: true
                        }
                    },
                    _count: {
                        select: {
                            participants: true,
                            posts: true
                        }
                    }
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                overview: {
                    total: totalChallenges,
                    pending: pendingChallenges,
                    approved: approvedChallenges,
                    active: activeChallenges,
                    rejected: rejectedChallenges,
                    ended: endedChallenges
                },
                engagement: {
                    total_participants: totalParticipants,
                    total_posts: totalPosts,
                    challenges_with_rewards: challengesWithRewards,
                    average_participants_per_challenge: totalChallenges > 0 ? Math.round(totalParticipants / totalChallenges) : 0,
                    average_posts_per_challenge: totalChallenges > 0 ? Math.round(totalPosts / totalChallenges) : 0
                },
                recent_challenges: recentChallenges.map(challenge => ({
                    id: challenge.id,
                    name: challenge.name,
                    status: challenge.status,
                    organizer: challenge.organizer,
                    participant_count: challenge._count.participants,
                    post_count: challenge._count.posts,
                    createdAt: challenge.createdAt
                }))
            }
        });
    } catch (error) {
        console.error('Error fetching challenge dashboard stats:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch dashboard statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get challenge growth analytics (for graphs)
exports.getChallengeGrowthAnalytics = async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(days));

        // Get challenges created over time
        const challengesByDate = await prisma.challenge.groupBy({
            by: ['createdAt'],
            where: {
                createdAt: {
                    gte: daysAgo
                }
            },
            _count: {
                id: true
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        // Get participants joined over time
        const participantsByDate = await prisma.challengeParticipant.groupBy({
            by: ['joined_at'],
            where: {
                joined_at: {
                    gte: daysAgo
                }
            },
            _count: {
                id: true
            },
            orderBy: {
                joined_at: 'asc'
            }
        });

        // Get posts submitted over time
        const postsByDate = await prisma.challengePost.groupBy({
            by: ['submitted_at'],
            where: {
                submitted_at: {
                    gte: daysAgo
                }
            },
            _count: {
                id: true
            },
            orderBy: {
                submitted_at: 'asc'
            }
        });

        // Format data for charts (group by day)
        const formatDate = (date) => {
            const d = new Date(date);
            return d.toISOString().split('T')[0];
        };

        const challengeGrowth = {};
        challengesByDate.forEach(item => {
            const date = formatDate(item.createdAt);
            challengeGrowth[date] = (challengeGrowth[date] || 0) + item._count.id;
        });

        const participantGrowth = {};
        participantsByDate.forEach(item => {
            const date = formatDate(item.joined_at);
            participantGrowth[date] = (participantGrowth[date] || 0) + item._count.id;
        });

        const postGrowth = {};
        postsByDate.forEach(item => {
            const date = formatDate(item.submitted_at);
            postGrowth[date] = (postGrowth[date] || 0) + item._count.id;
        });

        // Get all unique dates
        const allDates = new Set([
            ...Object.keys(challengeGrowth),
            ...Object.keys(participantGrowth),
            ...Object.keys(postGrowth)
        ]);

        // Create cumulative data
        const cumulativeData = Array.from(allDates).sort().map(date => {
            const challenges = challengeGrowth[date] || 0;
            const participants = participantGrowth[date] || 0;
            const posts = postGrowth[date] || 0;

            return {
                date,
                challenges,
                participants,
                posts
            };
        });

        // Calculate cumulative totals
        let cumulativeChallenges = 0;
        let cumulativeParticipants = 0;
        let cumulativePosts = 0;

        const cumulativeChartData = cumulativeData.map(item => {
            cumulativeChallenges += item.challenges;
            cumulativeParticipants += item.participants;
            cumulativePosts += item.posts;

            return {
                date: item.date,
                challenges: cumulativeChallenges,
                participants: cumulativeParticipants,
                posts: cumulativePosts
            };
        });

        res.json({
            status: 'success',
            data: {
                daily_data: cumulativeData,
                cumulative_data: cumulativeChartData,
                summary: {
                    total_challenges: cumulativeChallenges,
                    total_participants: cumulativeParticipants,
                    total_posts: cumulativePosts,
                    period_days: parseInt(days)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching challenge growth analytics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch growth analytics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get challenge analytics by ID (with growth data)
exports.getChallengeAnalytics = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { days = 30 } = req.query;
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(days));

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        email: true,
                        profile_picture: true
                    }
                },
                approver: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                },
                _count: {
                    select: {
                        participants: true,
                        posts: true
                    }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        // Get participants joined over time
        const participantsByDate = await prisma.challengeParticipant.findMany({
            where: {
                challenge_id: challengeId,
                joined_at: {
                    gte: daysAgo
                }
            },
            select: {
                joined_at: true
            },
            orderBy: {
                joined_at: 'asc'
            }
        });

        // Get posts submitted over time
        const postsByDate = await prisma.challengePost.findMany({
            where: {
                challenge_id: challengeId,
                submitted_at: {
                    gte: daysAgo
                }
            },
            select: {
                submitted_at: true
            },
            orderBy: {
                submitted_at: 'asc'
            }
        });

        // Format data for charts
        const formatDate = (date) => {
            const d = new Date(date);
            return d.toISOString().split('T')[0];
        };

        const participantGrowth = {};
        participantsByDate.forEach(item => {
            const date = formatDate(item.joined_at);
            participantGrowth[date] = (participantGrowth[date] || 0) + 1;
        });

        const postGrowth = {};
        postsByDate.forEach(item => {
            const date = formatDate(item.submitted_at);
            postGrowth[date] = (postGrowth[date] || 0) + 1;
        });

        // Get all unique dates
        const allDates = new Set([
            ...Object.keys(participantGrowth),
            ...Object.keys(postGrowth)
        ]);

        // Create daily data
        const dailyData = Array.from(allDates).sort().map(date => {
            const participants = participantGrowth[date] || 0;
            const posts = postGrowth[date] || 0;

            return {
                date,
                participants,
                posts
            };
        });

        // Calculate cumulative totals
        let cumulativeParticipants = 0;
        let cumulativePosts = 0;

        const cumulativeData = dailyData.map(item => {
            cumulativeParticipants += item.participants;
            cumulativePosts += item.posts;

            return {
                date: item.date,
                participants: cumulativeParticipants,
                posts: cumulativePosts
            };
        });

        // Get participant breakdown by post count
        const participantsWithPostCounts = await prisma.challengeParticipant.findMany({
            where: {
                challenge_id: challengeId
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true
                    }
                }
            }
        });

        const participantStats = await Promise.all(
            participantsWithPostCounts.map(async (participant) => {
                const postCount = await prisma.challengePost.count({
                    where: {
                        challenge_id: challengeId,
                        user_id: participant.user_id
                    }
                });

                return {
                    user_id: participant.user_id,
                    username: participant.user.username,
                    display_name: participant.user.display_name,
                    profile_picture: participant.user.profile_picture,
                    post_count: postCount,
                    joined_at: participant.joined_at
                };
            })
        );

        // Sort by post count
        participantStats.sort((a, b) => b.post_count - a.post_count);

        res.json({
            status: 'success',
            data: {
                challenge: {
                    ...challenge,
                    participant_count: challenge._count.participants,
                    post_count: challenge._count.posts
                },
                growth: {
                    daily_data: dailyData,
                    cumulative_data: cumulativeData,
                    period_days: parseInt(days)
                },
                participant_stats: {
                    total: participantStats.length,
                    top_contributors: participantStats.slice(0, 10),
                    participants_with_posts: participantStats.filter(p => p.post_count > 0).length,
                    participants_without_posts: participantStats.filter(p => p.post_count === 0).length,
                    average_posts_per_participant: participantStats.length > 0
                        ? Math.round(participantStats.reduce((sum, p) => sum + p.post_count, 0) / participantStats.length)
                        : 0
                }
            }
        });
    } catch (error) {
        console.error('Error fetching challenge analytics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenge analytics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ========== Admin user details, activity, posts, search, suspended users ==========

/** GET /admin/users/:userId - Full user details for admin */
exports.getAdminUserById = async (req, res) => {
    try {
        const { userId } = req.params;

        // Validate that userId is a UUID to avoid Prisma P2023 errors on bad input
        const uuidRegex = /^[0-9a-fA-F-]{36}$/;
        if (!uuidRegex.test(userId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid userId. Expected a UUID.'
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                display_name: true,
                email: true,
                email_verified: true,
                phone1: true,
                phone2: true,
                date_of_birth: true,
                posts_count: true,
                total_profile_views: true,
                profile_picture: true,
                bio: true,
                status: true,
                suspended_at: true,
                suspension_reason: true,
                role: true,
                last_login: true,
                last_active_date: true,
                follower_count: true,
                interests: true,
                createdAt: true,
                updatedAt: true,
                country_id: true,
                country: {
                    select: { id: true, name: true, code: true, flag_emoji: true }
                }
            }
        });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        const [postStats, reportCountOnPosts] = await Promise.all([
            prisma.post.aggregate({
                where: { user_id: userId },
                _sum: { views: true },
                _count: { id: true }
            }),
            prisma.postReport.count({
                where: { post: { user_id: userId } }
            })
        ]);
        const totalPostViews = postStats._sum.views || 0;
        const totalPosts = postStats._count.id || 0;
        res.json({
            status: 'success',
            data: {
                ...user,
                summary: {
                    totalPosts,
                    totalPostViews,
                    totalReportsOnContent: reportCountOnPosts
                }
            }
        });
    } catch (error) {
        console.error('Get admin user by ID error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching user',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/** GET /admin/users/:userId/activity - User activity in time buckets (frame: 1h|12h|24h|7d|30d) */
exports.getAdminUserActivity = async (req, res) => {
    try {
        const { userId } = req.params;
        const { frame = '24h' } = req.query;
        const { startDate, interval } = parseTimeFrame(frame);
        const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!exists) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        const trunc = interval === 'hour' ? 'hour' : 'day';
        const truncSql = trunc === 'hour' ? prisma.$queryRaw`SELECT date_trunc('hour', p."createdAt") AS period, COUNT(*)::int AS count FROM posts p WHERE p.user_id = ${userId}::uuid AND p."createdAt" >= ${startDate} GROUP BY date_trunc('hour', p."createdAt") ORDER BY period ASC`
            : prisma.$queryRaw`SELECT date_trunc('day', p."createdAt") AS period, COUNT(*)::int AS count FROM posts p WHERE p.user_id = ${userId}::uuid AND p."createdAt" >= ${startDate} GROUP BY date_trunc('day', p."createdAt") ORDER BY period ASC`;
        const postsRaw = await truncSql;
        const likesSql = trunc === 'hour' ? prisma.$queryRaw`SELECT date_trunc('hour', pl."createdAt") AS period, COUNT(*)::int AS count FROM post_likes pl WHERE pl.user_id = ${userId}::uuid AND pl."createdAt" >= ${startDate} GROUP BY date_trunc('hour', pl."createdAt") ORDER BY period ASC`
            : prisma.$queryRaw`SELECT date_trunc('day', pl."createdAt") AS period, COUNT(*)::int AS count FROM post_likes pl WHERE pl.user_id = ${userId}::uuid AND pl."createdAt" >= ${startDate} GROUP BY date_trunc('day', pl."createdAt") ORDER BY period ASC`;
        const likesRaw = await likesSql;
        const commentsSql = trunc === 'hour' ? prisma.$queryRaw`SELECT date_trunc('hour', c.comment_date) AS period, COUNT(*)::int AS count FROM comments c WHERE c.commentor_id = ${userId}::uuid AND c.comment_date >= ${startDate} GROUP BY date_trunc('hour', c.comment_date) ORDER BY period ASC`
            : prisma.$queryRaw`SELECT date_trunc('day', c.comment_date) AS period, COUNT(*)::int AS count FROM comments c WHERE c.commentor_id = ${userId}::uuid AND c.comment_date >= ${startDate} GROUP BY date_trunc('day', c.comment_date) ORDER BY period ASC`;
        const commentsRaw = await commentsSql;
        const byPeriod = {};
        const addPeriod = (period, postsCreated = 0, likesGiven = 0, commentsMade = 0) => {
            const key = period ? new Date(period).toISOString() : '';
            if (!byPeriod[key]) byPeriod[key] = { periodStart: period, periodEnd: null, postsCreated: 0, likesGiven: 0, commentsMade: 0 };
            byPeriod[key].postsCreated += postsCreated;
            byPeriod[key].likesGiven += likesGiven;
            byPeriod[key].commentsMade += commentsMade;
        };
        postsRaw.forEach(row => addPeriod(row.period, row.count || 0, 0, 0));
        likesRaw.forEach(row => addPeriod(row.period, 0, row.count || 0, 0));
        commentsRaw.forEach(row => addPeriod(row.period, 0, 0, row.count || 0));
        const buckets = Object.values(byPeriod).sort((a, b) => new Date(a.periodStart) - new Date(b.periodStart));
        res.json({ status: 'success', data: { frame, buckets } });
    } catch (error) {
        console.error('Get admin user activity error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching user activity',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/** GET /admin/users/:userId/posts - User's posts with details, optional frame filter */
exports.getAdminUserPosts = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20, status, sort = 'newest', frame } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;
        const where = { user_id: userId, is_ad: false };
        if (status && status !== 'all') {
            where.status = status;
        }
        if (frame) {
            const { startDate } = parseTimeFrame(frame);
            where.createdAt = { gte: startDate };
        }
        let orderBy = { createdAt: 'desc' };
        switch (sort) {
            case 'oldest': orderBy = { createdAt: 'asc' }; break;
            case 'most_liked': orderBy = [{ likes: 'desc' }, { createdAt: 'desc' }]; break;
            case 'most_viewed': orderBy = [{ views: 'desc' }, { createdAt: 'desc' }]; break;
            case 'most_reported': orderBy = [{ report_count: 'desc' }, { createdAt: 'desc' }]; break;
            default: break;
        }
        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where,
                include: {
                    category: { select: { id: true, name: true, description: true, level: true, parent: { select: { id: true, name: true } } } },
                    _count: { select: { postLikes: true, comments: true, postViews: true, postShares: true, reports: true, appeals: true } },
                    reports: { include: { user: { select: { id: true, username: true, display_name: true } } }, orderBy: { createdAt: 'desc' }, take: 5 },
                    appeals: { include: { user: { select: { id: true, username: true } } }, orderBy: { createdAt: 'desc' }, take: 3 }
                },
                orderBy,
                take: limitNum,
                skip: offset
            }),
            prisma.post.count({ where })
        ]);
        res.json({
            status: 'success',
            data: {
                posts,
                pagination: { page: pageNum, limit: limitNum, total: totalCount, totalPages: Math.ceil(totalCount / limitNum), hasNext: offset + limitNum < totalCount, hasPrev: pageNum > 1 },
                filters: { status: status || 'all', sort, frame: frame || null }
            }
        });
    } catch (error) {
        console.error('Get admin user posts error:', error);
        res.status(500).json({ status: 'error', message: 'Error fetching user posts', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

/** GET /admin/users/:userId/posts/engagement - User-level posts engagement summary, optional frame */
exports.getAdminUserPostsEngagement = async (req, res) => {
    try {
        const { userId } = req.params;
        const { frame = '30d' } = req.query;
        const { startDate } = parseTimeFrame(frame);
        const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!exists) return res.status(404).json({ status: 'error', message: 'User not found' });
        const postsInFrame = await prisma.post.findMany({
            where: { user_id: userId, createdAt: { gte: startDate }, is_ad: false },
            select: { id: true, views: true, likes: true, comment_count: true, shares: true, createdAt: true }
        });
        const totalPosts = postsInFrame.length;
        const totalViews = postsInFrame.reduce((s, p) => s + (p.views || 0), 0);
        const totalLikes = postsInFrame.reduce((s, p) => s + (p.likes || 0), 0);
        const totalComments = postsInFrame.reduce((s, p) => s + (p.comment_count || 0), 0);
        const totalShares = postsInFrame.reduce((s, p) => s + (p.shares || 0), 0);
        res.json({
            status: 'success',
            data: {
                frame,
                summary: { totalPostsInFrame: totalPosts, totalViews, totalLikes, totalComments, totalShares },
                engagementRate: totalViews > 0 ? Math.round(((totalLikes + totalComments + totalShares) / totalViews) * 10000) / 100 : 0
            }
        });
    } catch (error) {
        console.error('Get admin user posts engagement error:', error);
        res.status(500).json({ status: 'error', message: 'Error fetching engagement', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

/** GET /admin/posts/:postId/engagement - Post engagement in time buckets (frame: 1h|12h|24h|7d|30d) */
exports.getPostEngagement = async (req, res) => {
    try {
        const { postId } = req.params;
        const { frame = '24h' } = req.query;
        const { startDate, interval } = parseTimeFrame(frame);
        const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
        if (!post) return res.status(404).json({ status: 'error', message: 'Post not found' });
        const trunc = interval === 'hour' ? 'hour' : 'day';
        const [likesRaw, commentsRaw, viewsRaw] = await Promise.all([
            trunc === 'hour'
                ? prisma.$queryRaw`SELECT date_trunc('hour', "createdAt") AS period, COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}::uuid AND "createdAt" >= ${startDate} GROUP BY date_trunc('hour', "createdAt") ORDER BY period ASC`
                : prisma.$queryRaw`SELECT date_trunc('day', "createdAt") AS period, COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}::uuid AND "createdAt" >= ${startDate} GROUP BY date_trunc('day', "createdAt") ORDER BY period ASC`,
            trunc === 'hour'
                ? prisma.$queryRaw`SELECT date_trunc('hour', comment_date) AS period, COUNT(*)::int AS count FROM comments WHERE post_id = ${postId}::uuid AND comment_date >= ${startDate} GROUP BY date_trunc('hour', comment_date) ORDER BY period ASC`
                : prisma.$queryRaw`SELECT date_trunc('day', comment_date) AS period, COUNT(*)::int AS count FROM comments WHERE post_id = ${postId}::uuid AND comment_date >= ${startDate} GROUP BY date_trunc('day', comment_date) ORDER BY period ASC`,
            trunc === 'hour'
                ? prisma.$queryRaw`SELECT date_trunc('hour', "createdAt") AS period, COUNT(*)::int AS count FROM views WHERE post_id = ${postId}::uuid AND "createdAt" >= ${startDate} GROUP BY date_trunc('hour', "createdAt") ORDER BY period ASC`
                : prisma.$queryRaw`SELECT date_trunc('day', "createdAt") AS period, COUNT(*)::int AS count FROM views WHERE post_id = ${postId}::uuid AND "createdAt" >= ${startDate} GROUP BY date_trunc('day', "createdAt") ORDER BY period ASC`
        ]);
        const byPeriod = {};
        const add = (period, likes = 0, comments = 0, views = 0) => {
            const key = period ? new Date(period).toISOString() : '';
            if (!byPeriod[key]) byPeriod[key] = { periodStart: period, periodEnd: null, likes: 0, comments: 0, views: 0 };
            byPeriod[key].likes += likes;
            byPeriod[key].comments += comments;
            byPeriod[key].views += views;
        };
        likesRaw.forEach(r => add(r.period, r.count || 0, 0, 0));
        commentsRaw.forEach(r => add(r.period, 0, r.count || 0, 0));
        viewsRaw.forEach(r => add(r.period, 0, 0, r.count || 0));
        const buckets = Object.values(byPeriod).sort((a, b) => new Date(a.periodStart) - new Date(b.periodStart));
        res.json({ status: 'success', data: { frame, buckets } });
    } catch (error) {
        console.error('Get post engagement error:', error);
        res.status(500).json({ status: 'error', message: 'Error fetching post engagement', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

/** GET /admin/search - Unified search (q, type=all|users|posts), optional filters. User search is aggressive and type-tolerant. */
exports.adminUnifiedSearch = async (req, res) => {
    try {
        const { q, type = 'all', page = 1, limit = 20, status, dateFrom, dateTo, hasReports, suspended, role } = req.query;
        const queryNorm = normalizeQuery(q);
        if (!queryNorm) {
            return res.status(400).json({ status: 'error', message: 'Query parameter q is required and must be non-empty' });
        }
        const { pageNum, limitNum, offset } = parsePagination(page, limit, { maxLimit: 100 });
        const validTypes = ['all', 'users', 'posts', 'challenges'];
        const searchType = validTypes.includes(type) ? type : 'all';
        const results = { users: [], posts: [], challenges: [] };

        if (searchType === 'all' || searchType === 'users') {
            const userWhere = buildUserSearchWhere(q, { status, role, dateFrom, dateTo, suspended });
            const [users, userTotal] = await Promise.all([
                prisma.user.findMany({
                    where: userWhere,
                    select: { id: true, username: true, display_name: true, email: true, profile_picture: true, status: true, posts_count: true, createdAt: true },
                    orderBy: { createdAt: 'desc' },
                    take: searchType === 'users' ? limitNum : 10,
                    skip: searchType === 'users' ? offset : 0
                }),
                prisma.user.count({ where: userWhere })
            ]);
            results.users = users;
            results.userTotal = userTotal;
        }
        if (searchType === 'all' || searchType === 'posts') {
            const postWhere = buildPostSearchWhere(queryNorm, {
                status: suspended === 'true' ? 'suspended' : status,
                hasReports,
                dateFrom,
                dateTo,
                excludeAds: true
            });
            const [posts, postTotal] = await Promise.all([
                prisma.post.findMany({
                    where: postWhere,
                    include: {
                        user: { select: { id: true, username: true, display_name: true, profile_picture: true, status: true } },
                        category: { select: { id: true, name: true } },
                        _count: { select: { reports: true } }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: searchType === 'posts' ? limitNum : 10,
                    skip: searchType === 'posts' ? offset : 0
                }),
                prisma.post.count({ where: postWhere })
            ]);
            results.posts = posts;
            results.postTotal = postTotal;
        }
        if (searchType === 'all' || searchType === 'challenges') {
            const challengeWhere = buildChallengeSearchWhere(queryNorm, { status, dateFrom, dateTo });
            const [challenges, challengeTotal] = await Promise.all([
                prisma.challenge.findMany({
                    where: challengeWhere,
                    include: {
                        organizer: { select: { id: true, username: true, display_name: true, email: true, profile_picture: true } },
                        _count: { select: { participants: true, posts: true } }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: searchType === 'challenges' ? limitNum : 10,
                    skip: searchType === 'challenges' ? offset : 0
                }),
                prisma.challenge.count({ where: challengeWhere })
            ]);
            results.challenges = challenges;
            results.challengeTotal = challengeTotal;
        }

        const totalForType = searchType === 'users' ? results.userTotal : searchType === 'posts' ? results.postTotal : searchType === 'challenges' ? results.challengeTotal : undefined;
        res.json({
            status: 'success',
            data: {
                ...results,
                pagination: searchType !== 'all' ? { page: pageNum, limit: limitNum, total: totalForType } : undefined
            }
        });
    } catch (error) {
        console.error('Admin unified search error:', error);
        res.status(500).json({ status: 'error', message: 'Search failed', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

/** GET /admin/users/suspended - Suspended users with report context (reporters, times, reasons) */
exports.getSuspendedUsers = async (req, res) => {
    try {
        const { page = 1, limit = 20, sort = 'suspended_at_desc' } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;
        const [users, totalCount] = await Promise.all([
            prisma.user.findMany({
                where: { status: 'suspended' },
                select: {
                    id: true, username: true, display_name: true, email: true, profile_picture: true, status: true,
                    suspended_at: true, suspension_reason: true, posts_count: true, createdAt: true,
                    country: { select: { id: true, name: true, code: true, flag_emoji: true } }
                },
                orderBy: sort === 'created_at_desc' ? { createdAt: 'desc' } : { suspended_at: 'desc' },
                take: limitNum,
                skip: offset
            }),
            prisma.user.count({ where: { status: 'suspended' } })
        ]);
        const reportsByUserId = await prisma.postReport.findMany({
            where: { post: { user_id: { in: users.map(u => u.id) } } },
            include: {
                user: { select: { id: true, username: true, display_name: true, email: true } },
                post: { select: { id: true, user_id: true, title: true, status: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        const reportsByOwner = {};
        reportsByUserId.forEach(r => {
            const ownerId = r.post?.user_id;
            if (!ownerId) return;
            if (!reportsByOwner[ownerId]) reportsByOwner[ownerId] = [];
            reportsByOwner[ownerId].push({
                id: r.id, post_id: r.post_id, reason: r.reason, description: r.description, status: r.status, createdAt: r.createdAt,
                reporter: r.user
            });
        });
        const enriched = users.map(u => ({
            ...u,
            reportedPostsCount: (reportsByOwner[u.id] || []).length ? new Set((reportsByOwner[u.id] || []).map(x => x.post_id)).size : 0,
            totalReportsCount: (reportsByOwner[u.id] || []).length || 0,
            reportReasons: (reportsByOwner[u.id] || []).reduce((acc, r) => { acc[r.reason] = (acc[r.reason] || 0) + 1; return acc; }, {}),
            reports: reportsByOwner[u.id] || []
        }));
        res.json({
            status: 'success',
            data: {
                users: enriched,
                pagination: { page: pageNum, limit: limitNum, total: totalCount, totalPages: Math.ceil(totalCount / limitNum), hasNext: offset + limitNum < totalCount, hasPrev: pageNum > 1 }
            }
        });
    } catch (error) {
        console.error('Get suspended users error:', error);
        res.status(500).json({ status: 'error', message: 'Error fetching suspended users', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};
