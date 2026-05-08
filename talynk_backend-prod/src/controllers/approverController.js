const prisma = require('../lib/prisma');
const {validate, parse} = require('uuid');
const { emitEvent } = require('../lib/realtime');
const bcrypt = require('bcryptjs');

exports.getApproverStats = async (req, res) => {
    try {
        const approverId = req.user.id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [pendingCount, approvedCount, rejectedCount, todayCount] = await Promise.all([
            prisma.post.count({ where: { status: 'draft' } }),
            prisma.post.count({ 
                where: { 
                    status: 'active',
                    approver_id: approverId 
                } 
            }),
            prisma.post.count({ 
                where: { 
                    status: 'suspended',
                    approver_id: approverId 
                } 
            }),
            prisma.post.count({
                where: {
                    status: 'active',
                    approver_id: approverId,
                    updatedAt: {
                        gte: today
                    }
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                pendingCount,
                approvedCount,
                rejectedCount,
                todayCount
            }
        });
    } catch (error) {
        console.error('Stats fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching approver statistics'
        });
    }
};

exports.getPendingPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, total] = await Promise.all([
            prisma.post.findMany({
                where: { status: 'draft' },
                include: {
                    user: {
                        select: { username: true, email: true }
                    }
                },
                orderBy: { updatedAt: 'desc' },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { status: 'draft' }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                total,
                pages: Math.ceil(total / limit),
                currentPage: parseInt(page)
            }
        });
    } catch (error) {
        console.error('Pending posts fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching pending posts'
        });
    }
};

exports.getApprovedPosts = async (req, res) => {
    try {
        const { date, search, page = 1, limit = 10 } = req.query;
        const approverId = req.user.id;
        const whereClause = {
            status: 'active',
            approver_id: approverId
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
                        select: { username: true, email: true }
                    }
                },
                orderBy: { approved_at: 'desc' },
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
                posts,
                total,
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

exports.getPostDetails = async (req, res) => {
    try {
        const { postId } = req.params;

        const post = await prisma.post.findFirst({
            where: { id: postId },
            include: {
                user: {
                    select: { username: true, email: true }
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
            data: { post }
        });
    } catch (error) {
        console.error('Post details fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching post details'
        });
    }
};

exports.approvePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { notes } = req.body;
        const approverId = req.user.id;
        console.log("Got id ----->" + postId + "Type of it is : ----->" + typeof postId)

        const post = await prisma.post.findFirst({
            where: { 
                id: postId,
                status: 'draft'
            },
            include: {
                user: {
                    select: { username: true, id: true }
                }
            }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found or already processed'
            });
        }

        await prisma.post.update({
            where: { id: postId },
            data: {
                status: 'active',
                approver_id: approverId,
                approved_at: new Date(),
                review_notes: notes
            }
        });

        // Create notification
        if (post.user?.username) {
            const notification = await prisma.notification.create({
                data: {
                    userID: post.user.username,
                    message: 'Your post has been approved',
                    type: 'post_approved',
                    isRead: false
                }
            });
            
            // Emit real-time notification event
            emitEvent('notification:created', {
                userId: post.user.id,
                userID: post.user.username,
                notification: {
                    id: notification.id,
                    type: notification.type,
                    message: notification.message,
                    isRead: notification.isRead,
                    createdAt: notification.createdAt
                }
            });
        }

        res.json({
            status: 'success',
            message: 'Post approved successfully'
        });
    } catch (error) {
        console.error('Post approval error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error approving post'
        });
    }
};

exports.rejectPost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { notes } = req.body;
        const approverId = req.user.id;

        const post = await prisma.post.findFirst({
            where: { 
                id: postId,
                status: 'draft'
            },
            include: {
                user: {
                    select: { username: true, id: true }
                }
            }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found or already processed'
            });
        }

        await prisma.post.update({
            where: { id: postId },
            data: {
                status: 'suspended',
                approver_id: approverId,
                rejected_at: new Date(),
                review_notes: notes
            }
        });

        // Create notification
        if (post.user?.username) {
            const notification = await prisma.notification.create({
                data: {
                    userID: post.user.username,
                    message: `Your post has been rejected. Reason: ${notes}`,
                    type: 'post_rejected',
                    isRead: false
                }
            });
            
            // Emit real-time notification event
            emitEvent('notification:created', {
                userId: post.user.id,
                userID: post.user.username,
                notification: {
                    id: notification.id,
                    type: notification.type,
                    message: notification.message,
                    isRead: notification.isRead,
                    createdAt: notification.createdAt
                }
            });
        }

        res.json({
            status: 'success',
            message: 'Post rejected successfully'
        });
    } catch (error) {
        console.error('Post rejection error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error rejecting post'
        });
    }
};

exports.getApproverNotifications = async (req, res) => {
    try {
        const approverId = req.user.id;

        const notifications = await prisma.notification.findMany({
            where: { user_id: approverId },
            orderBy: { notification_date: 'desc' },
            take: 50
        });

        res.json({
            status: 'success',
            data: { notifications }
        });
    } catch (error) {
        console.error('Notifications fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching notifications'
        });
    }
};

exports.searchPosts = async (req, res) => {
    try {
        const { query, type, page = 1, limit = 10 } = req.query;
        if (!query || !type) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_PARAMETERS',
                    message: 'Query and type parameters are required'
                }
            });
        }
        const validTypes = ['post_id', 'post_title', 'user_id', 'username', 'date', 'status'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_SEARCH_TYPE',
                    message: `Invalid search type. Must be one of: ${validTypes.join(', ')}`
                }
            });
        }
        let whereClause = {};
        switch (type) {
            case 'post_id':
                whereClause.id = query;
                break;
            case 'post_title':
                whereClause.title = { 
                    mode: 'insensitive', 
                    contains: query 
                };
                break;
            case 'user_id':
                whereClause.user_id = query;
                break;
            case 'username':
                whereClause.user = {
                    username: {
                        mode: 'insensitive',
                        contains: query
                    }
                };
                break;
            case 'date':
                const searchDate = new Date(query);
                if (isNaN(searchDate.getTime())) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_DATE',
                            message: 'Invalid date format. Use YYYY-MM-DD'
                        }
                    });
                }
                whereClause.createdAt = {
                    gte: searchDate,
                    lt: new Date(searchDate.getTime() + 24 * 60 * 60 * 1000)
                };
                break;
            case 'status':
                // Map user-friendly status names to enum values
                const statusMap = {
                    'pending': 'draft',
                    'approved': 'active',
                    'rejected': 'suspended',
                    'draft': 'draft',
                    'active': 'active',
                    'suspended': 'suspended'
                };
                const mappedStatus = statusMap[query.toLowerCase()];
                if (!mappedStatus) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_STATUS',
                            message: `Invalid status. Must be one of: pending, approved, rejected, draft, active, suspended`
                        }
                    });
                }
                whereClause.status = mappedStatus;
                break;
        }
        // Only allow approver to see posts they are allowed to see
        whereClause.OR = [
            { approver_id: req.user.id },
            { status: 'draft' }
        ];
        
        const offset = (page - 1) * limit;
        const [posts, total] = await Promise.all([
            prisma.post.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: { id: true, username: true, email: true, status: true, profile_picture: true }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: whereClause
            })
        ]);
        
        const formattedPosts = posts.map(post => {
            return {
                id: post.id,
                title: post.title,
                description: post.description,
                status: post.status,
                created_at: post.createdAt,
                updated_at: post.updatedAt,
                user_id: post.user_id,
                user: post.user
            };
        });
        
        res.json({
            success: true,
            data: {
                posts: formattedPosts,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Error searching posts:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'An error occurred while searching posts'
            }
        });
    }
};

// Get all posts (for approvers to view all posts)
exports.getAllPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10, status } = req.query;
        const offset = (page - 1) * limit;

        // Build where clause
        const whereClause = {};
        
        // Filter by status if provided (all, pending, approved, rejected, frozen)
        if (status && status !== 'all') {
            whereClause.status = status;
        }

        const [posts, total] = await Promise.all([
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
                    },
                    approver: {
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
            prisma.post.count({
                where: whereClause
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalCount: total,
                    hasNext: page * limit < total,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Get all posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get flagged posts (for approvers to review flagged posts)
// Flagged posts are those with status 'suspended' (flagged by admin/approver or 5+ reports)
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
                            email: true,
                            profile_picture: true
                        }
                    },
                    category: {
                        select: {
                            id: true,
                            name: true
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

// Review flagged post (approve or reject after review)
exports.reviewFlaggedPost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { action, notes } = req.body; // action: 'approve' or 'reject'
        const approverId = req.user.id;

        // Validate action
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({
                status: 'error',
                message: 'Action must be either "approve" or "reject"'
            });
        }

        // Find the flagged post (flagged posts have status 'suspended' and is_frozen: true)
        const post = await prisma.post.findFirst({
            where: { 
                id: postId,
                status: 'suspended',
                is_frozen: true
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

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Flagged post not found'
            });
        }

        // Update post based on action
        const updateData = {
            approver_id: approverId,
            updatedAt: new Date()
        };

        if (action === 'approve') {
            updateData.status = 'active';
            updateData.is_frozen = false;
            updateData.approved_at = new Date();
            updateData.frozen_at = null;
        } else if (action === 'reject') {
            updateData.status = 'suspended';
            updateData.is_frozen = false;
            updateData.frozen_at = null;
        }

        await prisma.post.update({
            where: { id: postId },
            data: updateData
        });

        // Create notification for the user
        if (post.user?.username) {
            const notificationMessage = action === 'approve' 
                ? 'Your flagged post has been reviewed and approved' 
                : `Your flagged post has been reviewed and rejected. Reason: ${notes || 'Violation of community guidelines'}`;

            await prisma.notification.create({
                data: {
                    userID: post.user.username,
                    message: notificationMessage,
                    type: 'post_review',
                    isRead: false
                }
            });
        }

        res.json({
            status: 'success',
            message: `Flagged post ${action}d successfully`,
            data: {
                postId,
                action,
                reviewedBy: approverId
            }
        });
    } catch (error) {
        console.error('Review flagged post error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error reviewing flagged post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get suspended posts (for approvers to review)
exports.getSuspendedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, total] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'suspended'
                },
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
                    },
                    approver: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    }
                },
                orderBy: { updatedAt: 'desc' },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { status: 'suspended' }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalCount: total,
                    hasNext: page * limit < total,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Get suspended posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching suspended posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get posts in traffic (active posts with high views)
exports.getPostsInTraffic = async (req, res) => {
    try {
        const { page = 1, limit = 10, minViews = 100 } = req.query;
        const offset = (page - 1) * limit;

        const [posts, total] = await Promise.all([
            prisma.post.findMany({
                where: { 
                    status: 'active',
                    views: {
                        gte: parseInt(minViews)
                    }
                },
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
                orderBy: { views: 'desc' },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: { 
                    status: 'active',
                    views: {
                        gte: parseInt(minViews)
                    }
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalCount: total,
                    hasNext: page * limit < total,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Get posts in traffic error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching posts in traffic',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Suspend a post (approver can suspend posts)
exports.suspendPost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { reason } = req.body;
        const approverId = req.user.id;

        const post = await prisma.post.findFirst({
            where: { id: postId },
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

        // Update post to suspended status (flagged posts have status 'suspended' and is_frozen: true)
        await prisma.post.update({
            where: { id: postId },
            data: {
                status: 'suspended',
                is_frozen: true,
                frozen_at: new Date(),
                approver_id: approverId,
                updatedAt: new Date()
            }
        });

        // Create notification for the user (include appeal mention)
        if (post.user?.username) {
            const msg = `Your post has been suspended. Reason: ${reason || 'Violation of community guidelines'}. You can appeal this decision if you believe it's a mistake.`;
            const notification = await prisma.notification.create({
                data: {
                    userID: post.user.username,
                    message: msg,
                    type: 'post_suspended',
                    isRead: false
                }
            });
            
            // Emit real-time notification event
            emitEvent('notification:created', {
                userId: post.user.id,
                userID: post.user.username,
                notification: {
                    id: notification.id,
                    type: notification.type,
                    message: notification.message,
                    isRead: notification.isRead,
                    createdAt: notification.createdAt
                }
            });
        }

        // Check and auto-suspend user if they have 3+ suspended posts
        if (post.user_id) {
            const { checkAndSuspendUser } = require('../utils/userSuspensionService');
            const suspensionResult = await checkAndSuspendUser(post.user_id, postId);
            
            if (suspensionResult.suspended) {
                console.log(`[Approver] User ${post.user?.username} automatically suspended: ${suspensionResult.message}`);
            }
        }

        res.json({
            status: 'success',
            message: 'Post suspended successfully',
            data: {
                postId,
                suspendedBy: approverId
            }
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

// Monitor users with high suspended videos count
exports.getUsersWithHighSuspendedVideos = async (req, res) => {
    try {
        const { page = 1, limit = 10, minSuspendedCount = 3 } = req.query;
        const offset = (page - 1) * limit;

        // Get users with suspended posts count
        const usersWithSuspendedCount = await prisma.post.groupBy({
            by: ['user_id'],
            where: {
                status: 'suspended',
                user_id: {
                    not: null
                }
            },
            _count: {
                id: true
            },
            having: {
                id: {
                    _count: {
                        gte: parseInt(minSuspendedCount)
                    }
                }
            }
        });

        const userIds = usersWithSuspendedCount.map(item => item.user_id);

        if (userIds.length === 0) {
            return res.json({
                status: 'success',
                data: {
                    users: [],
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: 0,
                        totalCount: 0,
                        hasNext: false,
                        hasPrev: false
                    }
                }
            });
        }

        // Get user details with their suspended posts count
        const usersWithCounts = await Promise.all(
            userIds.map(async (userId) => {
                const user = await prisma.user.findUnique({
                    where: { id: userId },
                    include: {
                        posts: {
                            where: {
                                status: 'suspended'
                            },
                            select: {
                                id: true,
                                title: true,
                                status: true,
                                createdAt: true,
                                updatedAt: true
                            },
                            orderBy: {
                                updatedAt: 'desc'
                            }
                        },
                        _count: {
                            select: {
                                posts: {
                                    where: {
                                        status: 'suspended'
                                    }
                                }
                            }
                        }
                    }
                });
                return user;
            })
        );

        // Filter out null users and sort by suspended posts count (descending)
        const validUsers = usersWithCounts.filter(user => user !== null);
        const sortedUsers = validUsers.sort((a, b) => b._count.posts - a._count.posts);
        
        // Paginate
        const total = sortedUsers.length;
        const paginatedUsers = sortedUsers.slice(offset, offset + parseInt(limit));

        // Format response with suspended count
        const formattedUsers = paginatedUsers.map(user => ({
            id: user.id,
            username: user.username,
            email: user.email,
            profile_picture: user.profile_picture,
            suspended_posts_count: user._count.posts,
            suspended_posts: user.posts,
            createdAt: user.createdAt
        }));

        res.json({
            status: 'success',
            data: {
                users: formattedUsers,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalCount: total,
                    hasNext: page * limit < total,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Get users with high suspended videos error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching users with high suspended videos',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Complete approver onboarding (set password, first name, last name, phone number)
exports.completeOnboarding = async (req, res) => {
    try {
        const { token, password, first_name, last_name, phone_number } = req.body;

        // Validate required fields
        if (!token || !password || !first_name || !last_name || !phone_number) {
            return res.status(400).json({
                status: 'error',
                message: 'Token, password, first_name, last_name, and phone_number are required'
            });
        }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({
                status: 'error',
                message: 'Password must be at least 6 characters long'
            });
        }

        // Find approver by onboarding token
        const approver = await prisma.approver.findUnique({
            where: { onboarding_token: token }
        });

        if (!approver) {
            return res.status(404).json({
                status: 'error',
                message: 'Invalid or expired onboarding token'
            });
        }

        // Check if already onboarded
        if (approver.password_set) {
            return res.status(400).json({
                status: 'error',
                message: 'Onboarding already completed'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate username from email if not set
        const username = approver.username || approver.email.split('@')[0];

        // Update approver with all information
        const updatedApprover = await prisma.approver.update({
            where: { id: approver.id },
            data: {
                password: hashedPassword,
                first_name,
                last_name,
                phone_number,
                username,
                password_set: true,
                status: 'active',
                onboarding_token: null // Clear token after use
            },
            select: {
                id: true,
                email: true,
                username: true,
                first_name: true,
                last_name: true,
                phone_number: true,
                status: true,
                createdAt: true
            }
        });

        res.json({
            status: 'success',
            message: 'Onboarding completed successfully',
            data: {
                approver: updatedApprover
            }
        });
    } catch (error) {
        console.error('Complete onboarding error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error completing onboarding',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};