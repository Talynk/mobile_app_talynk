const prisma = require('../lib/prisma');
const { emitEvent } = require('../lib/realtime');
const adminNotificationService = require('../services/adminNotificationService');
const { getPostReportSuspendThreshold } = require('../utils/moderationSettings');
const { invalidatePostCaches } = require('../utils/postCacheInvalidation');

// Report a post
exports.reportPost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { reason, description } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!reason) {
            return res.status(400).json({
                status: 'error',
                message: 'Report reason is required'
            });
        }

        // Check if post exists
        const post = await prisma.post.findUnique({
            where: { id: postId }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        // Check if user already reported this post
        const existingReport = await prisma.postReport.findUnique({
            where: {
                post_id_user_id: {
                    post_id: postId,
                    user_id: userId
                }
            }
        });

        if (existingReport) {
            return res.status(400).json({
                status: 'error',
                message: 'You have already reported this post'
            });
        }

        // Create the report
        const report = await prisma.postReport.create({
            data: {
                post_id: postId,
                user_id: userId,
                reason: reason,
                description: description || null
            }
        });

        // Notify admin (consolidated by post)
        adminNotificationService.create({
            severity: 'action_required',
            category: 'report',
            title: 'New report on post',
            message: `New report on post (reason: ${reason}). Total reports: ${(post.report_count || 0) + 1}.`,
            actionUrl: `/admin/posts/${postId}`,
            consolidatedKey: `report:${postId}`,
            metadata: { postId, reportId: report.id },
        }).catch((err) => console.error('[Report] Admin notification error:', err));

        // Increment report count on the post
        const updatedPost = await prisma.post.update({
            where: { id: postId },
            data: {
                report_count: {
                    increment: 1
                }
            }
        });

        const reportSuspendThreshold = await getPostReportSuspendThreshold();

        // Check if post should be flagged based on configured report threshold
        if (updatedPost.report_count >= reportSuspendThreshold && updatedPost.status !== 'suspended') {
            await prisma.post.update({
                where: { id: postId },
                data: {
                    is_frozen: true,
                    frozen_at: new Date(),
                    status: 'suspended'
                }
            });
            await invalidatePostCaches();

            // Create notification for post owner
            const postOwner = await prisma.user.findUnique({
                where: { id: post.user_id },
                select: { username: true }
            });
            
            if (postOwner) {
                const postOwnerUser = await prisma.user.findUnique({
                    where: { username: postOwner.username },
                    select: { id: true }
                });
                
                const notification = await prisma.notification.create({
                    data: {
                        userID: postOwner.username,
                        message: 'Your post has been flagged due to multiple reports. You can appeal this decision.',
                        type: 'post_flagged',
                        isRead: false
                    }
                });
                
                // Emit real-time notification event
                if (postOwnerUser) {
                    emitEvent('notification:created', {
                        userId: postOwnerUser.id,
                        userID: postOwner.username,
                        notification: {
                            id: notification.id,
                            type: notification.type,
                            message: notification.message,
                            isRead: notification.isRead,
                            createdAt: notification.createdAt
                        }
                    });
                }
            }

            // Notify admin that post was auto-flagged and needs review
            adminNotificationService.create({
                severity: 'action_required',
                category: 'report',
                title: 'Post flagged - review needed',
                message: `Post reached report threshold and was auto-flagged. Review and resolve reports.`,
                actionUrl: `/admin/posts/${postId}`,
                metadata: { postId },
            }).catch((err) => console.error('[Report] Admin notification error:', err));

            // Check and auto-suspend user if they have 3+ suspended posts
            if (post.user_id) {
                const { checkAndSuspendUser } = require('../utils/userSuspensionService');
                const suspensionResult = await checkAndSuspendUser(post.user_id, postId);
                
                if (suspensionResult.suspended) {
                    console.log(`[Report] User automatically suspended: ${suspensionResult.message}`);
                }
            }
        }

        res.status(201).json({
            status: 'success',
            message: 'Post reported successfully',
            data: {
                report: {
                    id: report.id,
                    reason: report.reason,
                    description: report.description,
                    createdAt: report.createdAt
                },
                postReportCount: updatedPost.report_count,
                isFrozen: updatedPost.report_count >= reportSuspendThreshold
            }
        });

    } catch (error) {
        console.error('Report post error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error reporting post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all reports (Admin only)
exports.getAllReports = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, reason } = req.query;
        const offset = (page - 1) * limit;

        const whereClause = {};
        if (status) whereClause.status = status;
        if (reason) whereClause.reason = reason;

        const [reports, totalCount] = await Promise.all([
            prisma.postReport.findMany({
                where: whereClause,
                include: {
                    post: {
                        select: {
                            id: true,
                            title: true,
                            status: true,
                            is_frozen: true,
                            report_count: true
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
                orderBy: {
                    createdAt: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.postReport.count({
                where: whereClause
            })
        ]);

        res.json({
            status: 'success',
            data: {
                reports,
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
        console.error('Get reports error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching reports',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Review a report (Admin only)
exports.reviewReport = async (req, res) => {
    try {
        const { reportId } = req.params;
        const { status, adminNotes } = req.body;
        const adminId = req.user.id;

        // Validate status
        const validStatuses = ['reviewed', 'resolved', 'dismissed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid status. Must be one of: reviewed, resolved, dismissed'
            });
        }

        // Fetch current report for description, then update
        const existingReport = await prisma.postReport.findUnique({
            where: { id: reportId },
            select: { description: true }
        });
        if (!existingReport) {
            return res.status(404).json({
                status: 'error',
                message: 'Report not found'
            });
        }
        const updateData = {
            status: status,
            reviewed_by: adminId,
            reviewed_at: new Date()
        };
        if (adminNotes) {
            updateData.description = (existingReport.description || '') + '\n\nAdmin Notes: ' + adminNotes;
        }
        const report = await prisma.postReport.update({
            where: { id: reportId },
            data: updateData,
            include: {
                post: {
                    select: {
                        id: true,
                        title: true,
                        user_id: true,
                        user: {
                            select: {
                                id: true,
                                username: true
                            }
                        }
                    }
                },
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            }
        });

        // Notify reporter (user who submitted the report) with outcome and optional admin note
        if (report.user?.username) {
            const reporterMessage = adminNotes
                ? `Your report was reviewed. Outcome: ${status}. Admin note: ${adminNotes}`
                : `Your report was reviewed. Outcome: ${status}.`;
            const reporterNotification = await prisma.notification.create({
                data: {
                    userID: report.user.username,
                    message: reporterMessage,
                    type: 'report_reviewed',
                    isRead: false,
                    postId: report.post_id
                }
            });
            emitEvent('notification:created', {
                userId: report.user.id,
                userID: report.user.username,
                notification: {
                    id: reporterNotification.id,
                    type: reporterNotification.type,
                    message: reporterNotification.message,
                    isRead: reporterNotification.isRead,
                    createdAt: reporterNotification.createdAt,
                    postId: report.post_id
                }
            });
        }

        // If report is resolved, unfreeze the post and notify post owner
        if (status === 'resolved') {
            await prisma.post.update({
                where: { id: report.post_id },
                data: {
                    is_frozen: false,
                    frozen_at: null,
                    status: 'active'
                }
            });

            // Notify post owner (userID must be username, not user ID)
            if (report.post.user?.username) {
                const notification = await prisma.notification.create({
                    data: {
                        userID: report.post.user.username,
                        message: 'Your post has been reviewed and unfrozen',
                        type: 'post_unfrozen',
                        isRead: false
                    }
                });
                
                // Emit real-time notification event
                emitEvent('notification:created', {
                    userId: report.post.user.id,
                    userID: report.post.user.username,
                    notification: {
                        id: notification.id,
                        type: notification.type,
                        message: notification.message,
                        isRead: notification.isRead,
                        createdAt: notification.createdAt
                    }
                });
            }
        }

        // If report is dismissed, optionally notify post owner
        if (status === 'dismissed' && report.post.user?.username) {
            const ownerNotification = await prisma.notification.create({
                data: {
                    userID: report.post.user.username,
                    message: 'A report on your content was reviewed and dismissed.',
                    type: 'report_reviewed',
                    isRead: false,
                    postId: report.post_id
                }
            });
            emitEvent('notification:created', {
                userId: report.post.user.id,
                userID: report.post.user.username,
                notification: {
                    id: ownerNotification.id,
                    type: ownerNotification.type,
                    message: ownerNotification.message,
                    isRead: ownerNotification.isRead,
                    createdAt: ownerNotification.createdAt,
                    postId: report.post_id
                }
            });
        }

        res.json({
            status: 'success',
            message: 'Report reviewed successfully',
            data: { report }
        });

    } catch (error) {
        console.error('Review report error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error reviewing report',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get reports for a specific post
exports.getPostReports = async (req, res) => {
    try {
        const { postId } = req.params;

        const reports = await prisma.postReport.findMany({
            where: { post_id: postId },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                },
                reviewer: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
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

// Get report statistics (Admin only)
exports.getReportStats = async (req, res) => {
    try {
        const stats = await Promise.all([
            prisma.postReport.count(),
            prisma.postReport.count({ where: { status: 'pending' } }),
            prisma.postReport.count({ where: { status: 'reviewed' } }),
            prisma.postReport.count({ where: { status: 'resolved' } }),
            prisma.postReport.count({ where: { status: 'dismissed' } }),
            prisma.post.count({ where: { is_frozen: true } }),
            prisma.postReport.groupBy({
                by: ['reason'],
                _count: {
                    reason: true
                }
            })
        ]);

        const [totalReports, pendingReports, reviewedReports, resolvedReports, dismissedReports, frozenPosts, reportsByReason] = stats;

        res.json({
            status: 'success',
            data: {
                totalReports,
                pendingReports,
                reviewedReports,
                resolvedReports,
                dismissedReports,
                frozenPosts,
                reportsByReason: reportsByReason.map(item => ({
                    reason: item.reason,
                    count: item._count.reason
                }))
            }
        });

    } catch (error) {
        console.error('Get report stats error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching report statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Appeal a flagged post
exports.appealPost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { appealReason, additionalInfo } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!appealReason) {
            return res.status(400).json({
                status: 'error',
                message: 'Appeal reason is required'
            });
        }

        // Check if post exists and belongs to the user
        const post = await prisma.post.findFirst({
            where: { 
                id: postId,
                user_id: userId,
                status: 'suspended'
            }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found, not owned by you, or not flagged'
            });
        }

        // Check if user already appealed this post
        const existingAppeal = await prisma.postAppeal.findFirst({
            where: {
                post_id: postId,
                user_id: userId
            }
        });

        if (existingAppeal) {
            return res.status(400).json({
                status: 'error',
                message: 'You have already appealed this post'
            });
        }

        // Create the appeal
        const appeal = await prisma.postAppeal.create({
            data: {
                post_id: postId,
                user_id: userId,
                appeal_reason: appealReason,
                additional_info: additionalInfo || null,
                status: 'pending'
            }
        });

        // Notify admin portal (real-time admin notification)
        adminNotificationService.create({
            severity: 'action_required',
            category: 'appeal',
            title: 'New appeal submitted',
            message: `New appeal for post: ${post.title}`,
            actionUrl: `/admin/appeals`,
            consolidatedKey: `appeal:${appeal.id}`,
            metadata: { appealId: appeal.id, postId },
        }).catch((err) => console.error('[Appeal] Admin notification error:', err));

        // Create notification for admins (legacy user notifications if admin has user record)
        const admins = await prisma.admin.findMany({
            select: { username: true }
        });

        for (const admin of admins) {
            const adminUser = await prisma.user.findUnique({
                where: { username: admin.username },
                select: { id: true }
            });
            
            if (adminUser) {
                const notification = await prisma.notification.create({
                    data: {
                        userID: admin.username,
                        message: `New appeal submitted for flagged post: ${post.title}`,
                        type: 'post_appeal',
                        isRead: false
                    }
                });
                
                // Emit real-time notification event
                emitEvent('notification:created', {
                    userId: adminUser.id,
                    userID: admin.username,
                    notification: {
                        id: notification.id,
                        type: notification.type,
                        message: notification.message,
                        isRead: notification.isRead,
                        createdAt: notification.createdAt
                    }
                });
            }
        }

        res.status(201).json({
            status: 'success',
            message: 'Appeal submitted successfully',
            data: {
                appeal: {
                    id: appeal.id,
                    appeal_reason: appeal.appeal_reason,
                    additional_info: appeal.additional_info,
                    status: appeal.status,
                    createdAt: appeal.createdAt
                }
            }
        });

    } catch (error) {
        console.error('Appeal post error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error submitting appeal',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get user's appeals
exports.getUserAppeals = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const [appeals, totalCount] = await Promise.all([
            prisma.postAppeal.findMany({
                where: { user_id: userId },
                include: {
                    post: {
                        select: {
                            id: true,
                            title: true,
                            status: true,
                            report_count: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.postAppeal.count({
                where: { user_id: userId }
            })
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
        console.error('Get user appeals error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching appeals',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Review an appeal (Admin only)
exports.reviewAppeal = async (req, res) => {
    try {
        const { appealId } = req.params;
        const { status, adminNotes } = req.body;
        const adminId = req.user.id;

        // Validate status
        const validStatuses = ['approved', 'rejected'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid status. Must be one of: approved, rejected'
            });
        }

        // Update the appeal
        const appeal = await prisma.postAppeal.update({
            where: { id: appealId },
            data: {
                status: status,
                reviewed_by: adminId,
                reviewed_at: new Date(),
                admin_notes: adminNotes || null
            },
            include: {
                post: {
                    select: {
                        id: true,
                        title: true,
                        user_id: true
                    }
                },
                user: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            }
        });

        // If appeal is approved, unfreeze the post
        if (status === 'approved') {
            await prisma.post.update({
                where: { id: appeal.post_id },
                data: {
                    is_frozen: false,
                    frozen_at: null,
                    status: 'active',
                    report_count: 0 // Reset report count
                }
            });

            // Notify post owner (include admin message if provided)
            const postOwner = await prisma.user.findUnique({
                where: { id: appeal.post.user_id },
                select: { username: true }
            });
            
            if (postOwner) {
                const postOwnerUser = await prisma.user.findUnique({
                    where: { username: postOwner.username },
                    select: { id: true }
                });
                const baseMessage = 'Your post has been restored.';
                const message = appeal.admin_notes
                    ? `${baseMessage} ${appeal.admin_notes}`
                    : baseMessage;
                const notification = await prisma.notification.create({
                    data: {
                        userID: postOwner.username,
                        message,
                        type: 'appeal_approved',
                        isRead: false,
                        postId: appeal.post.id
                    }
                });
                
                // Emit real-time notification event
                if (postOwnerUser) {
                    emitEvent('notification:created', {
                        userId: postOwnerUser.id,
                        userID: postOwner.username,
                        notification: {
                            id: notification.id,
                            type: notification.type,
                            message: notification.message,
                            isRead: notification.isRead,
                            createdAt: notification.createdAt,
                            postId: appeal.post.id,
                            actorId: adminId
                        }
                    });
                }
            }
        } else {
            // Notify post owner that appeal was rejected (include admin response when present)
            const postOwner = await prisma.user.findUnique({
                where: { id: appeal.post.user_id },
                select: { username: true }
            });
            
            if (postOwner) {
                const postOwnerUser = await prisma.user.findUnique({
                    where: { username: postOwner.username },
                    select: { id: true }
                });
                const baseMessage = 'Your appeal has been rejected.';
                const message = appeal.admin_notes
                    ? `${baseMessage} Admin response: ${appeal.admin_notes}`
                    : `${baseMessage} The post remains flagged.`;
                const notification = await prisma.notification.create({
                    data: {
                        userID: postOwner.username,
                        message,
                        type: 'appeal_rejected',
                        isRead: false,
                        postId: appeal.post.id
                    }
                });
                
                // Emit real-time notification event
                if (postOwnerUser) {
                    emitEvent('notification:created', {
                        userId: postOwnerUser.id,
                        userID: postOwner.username,
                        notification: {
                            id: notification.id,
                            type: notification.type,
                            message: notification.message,
                            isRead: notification.isRead,
                            createdAt: notification.createdAt,
                            postId: appeal.post.id,
                            actorId: adminId
                        }
                    });
                }
            }
        }

        res.json({
            status: 'success',
            message: 'Appeal reviewed successfully',
            data: { appeal }
        });

    } catch (error) {
        console.error('Review appeal error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error reviewing appeal',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all appeals (Admin only)
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
                orderBy: {
                    createdAt: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.postAppeal.count({
                where: whereClause
            })
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

