const prisma = require('../lib/prisma');
const { clearCacheByPattern } = require('../utils/cache');
const { emitEvent } = require('../lib/realtime');

exports.addComment = async (req, res) => {
    try {
        const { postId } = req.params;
        const { comment_text } = req.body;
        const authId = req.user?.id || req.user?.userId;
        const authUsername = req.user?.username || null;
        const authRole = req.user?.role || 'user';

        if (!authId && !authUsername) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized: missing user context'
            });
        }
        // Only regular users can comment
        if (authRole && authRole !== 'user') {
            return res.status(403).json({
                status: 'error',
                message: 'Only regular users can add comments'
            });
        }
        if (!comment_text || !comment_text.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Comment text is required'
            });
        }

        // Ensure post exists
        const existingPost = await prisma.post.findUnique({
            where: { id: postId },
            select: { id: true, user_id: true, title: true }
        });
        if (!existingPost) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        // Resolve authenticated user to a real users table record
        const resolvedUser = await prisma.user.findFirst({
            where: {
                OR: [
                    ...(authId ? [{ id: authId }] : []),
                    ...(authUsername ? [{ username: authUsername }] : [])
                ]
            },
            select: { id: true, username: true }
        });
        if (!resolvedUser) {
            return res.status(401).json({
                status: 'error',
                message: 'Authenticated user not found'
            });
        }

        // Create comment using Prisma
        const comment = await prisma.comment.create({
            data: {
                commentor_id: resolvedUser.id,
                post_id: postId,
                comment_text: comment_text.trim(),
                comment_date: new Date()
            }
        });

        // Increment post's comment count using Prisma
        await prisma.post.update({
            where: { id: postId },
            data: {
                comment_count: {
                    increment: 1
                }
            }
        });

        // Create notification for post owner (if not commenting on own post)
        if (existingPost && existingPost.user_id !== resolvedUser.id) {
            try {
                // Get post owner with notification preference
                const postOwner = await prisma.user.findUnique({
                    where: { id: existingPost.user_id },
                    select: { id: true, username: true, notification: true }
                });

                // Only create notification if:
                // 1. Post owner exists
                // 2. Post owner has a username
                // 3. Post owner has notifications enabled
                if (postOwner && postOwner.username && postOwner.notification) {
                    const notification = await prisma.notification.create({
                        data: {
                            userID: postOwner.username,
                            message: `${resolvedUser.username || 'Someone'} commented on your post`,
                            type: 'comment',
                            isRead: false,
                            actorId: resolvedUser.id,  // User who commented
                            postId: postId             // Post that was commented on
                        }
                    });

                    // Emit real-time notification event
                    emitEvent('notification:created', {
                        userId: postOwner.id,
                        userID: postOwner.username,
                        notification: {
                            id: notification.id,
                            type: notification.type,
                            message: notification.message,
                            isRead: notification.isRead,
                            createdAt: notification.createdAt
                        }
                    });

                    console.log(`Comment notification created: ${resolvedUser.username} commented on post by ${postOwner.username}`);
                }
            } catch (notificationError) {
                console.error('Error creating comment notification:', notificationError);
                // Don't throw - notification failure shouldn't break the comment action
            }
        }

        await clearCacheByPattern('single_post');
        await clearCacheByPattern('all_posts');
        await clearCacheByPattern('following_posts');
        await clearCacheByPattern('search_posts');

        emitEvent('comment:created', {
            postId,
            commentId: comment.id,
            userId: resolvedUser.id,
        });

        res.status(201).json({
            status: 'success',
            data: { comment }
        });
    } catch (error) {
        console.error('Comment creation error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error adding comment',
            details: error.message
        });
    }
};

exports.getPostComments = async (req, res) => {
    try {
        const { postId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const [comments, total] = await Promise.all([
            prisma.comment.findMany({
                where: { post_id: postId },
                select: {
                    id: true,
                    commentor_id: true,
                    comment_date: true,
                    post_id: true,
                    comment_text: true,
                    comment_reports: true,
                    user: {
                        select: {
                            id: true,
                            username: true,
                            profile_picture: true
                        }
                    }
                },
                orderBy: { comment_date: 'desc' },
                take: limit,
                skip: offset
            }),
            prisma.comment.count({ where: { post_id: postId } })
        ]);

        res.json({
            status: 'success',
            data: { comments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }
        });
    } catch (error) {
        console.error('Comments fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching comments',
            details: error.message
        });
    }
};

exports.deleteComment = async (req, res) => {
    try {
        const { commentId } = req.params;
        console.log('Delete comment request:', { commentId, userId: req.user?.id });
        
        // Validate UUID format (basic)
        const uuidRegex = /^[0-9a-fA-F-]{36}$/;
        if (!uuidRegex.test(String(commentId))) {
            console.log('Invalid UUID format:', commentId);
            return res.status(400).json({ status: 'error', message: 'Invalid comment ID' });
        }
        
        const userId = req.user?.id || req.user?.userId;
        
        console.log('Full req.user object:', req.user);
        console.log('Extracted userId:', userId);
        console.log('req.user.id:', req.user?.id);
        console.log('req.user.userId:', req.user?.userId);

        if (!userId) {
            console.log('No user ID found in request');
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized: missing user context'
            });
        }

        // Fetch the comment with post owner info
        const comment = await prisma.comment.findUnique({
            where: { id: commentId },
            select: { 
                id: true, 
                post_id: true, 
                commentor_id: true,
                post: {
                    select: {
                        user_id: true
                    }
                }
            }
        });

        console.log('Comment found:', comment);

        if (!comment) {
            console.log('Comment not found:', commentId);
            return res.status(404).json({
                status: 'error',
                message: 'Comment not found'
            });
        }

        // Check if user is comment owner OR post owner
        const isCommentOwner = comment.commentor_id === userId;
        const isPostOwner = comment.post.user_id === userId;
        
        console.log('Permission check:', { 
            isCommentOwner, 
            isPostOwner, 
            commentorId: comment.commentor_id, 
            postOwnerId: comment.post.user_id,
            currentUserId: userId 
        });

        if (!isCommentOwner && !isPostOwner) {
            console.log('User not authorized to delete comment');
            return res.status(403).json({
                status: 'error',
                message: 'You can only delete your own comments or comments on your posts'
            });
        }

        const postId = comment.post_id;

        // Delete the comment with Prisma
        await prisma.comment.delete({
            where: { id: commentId }
        });

        console.log('Comment deleted successfully, updating post count');

        // Decrement post's comment count safely with Prisma
        await prisma.post.update({
            where: { id: postId },
            data: {
                comment_count: {
                    decrement: 1
                }
            }
        });

        console.log('Post comment count decremented');

        // Get updated comment count
        const updatedPost = await prisma.post.findUnique({
            where: { id: postId },
            select: { comment_count: true }
        });

        await clearCacheByPattern('single_post');
        await clearCacheByPattern('all_posts');
        await clearCacheByPattern('following_posts');
        await clearCacheByPattern('search_posts');

        emitEvent('comment:deleted', { 
            postId, 
            commentId,
            commentCount: updatedPost?.comment_count || 0
        });

        res.json({
            status: 'success',
            message: 'Comment deleted successfully'
        });
    } catch (error) {
        console.error('Comment deletion error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error deleting comment',
            details: error.message
        });
    }
};

exports.reportComment = async (req, res) => {
    try {
        const { commentId } = req.params;
        const { reason, description } = req.body || {};
        const userId = req.user?.id || req.user?.userId;
        
        console.log('Report comment request:', { commentId, userId, reason });
        
        if (!reason || !String(reason).trim()) {
            console.log('Missing report reason');
            return res.status(400).json({
                status: 'error',
                message: 'Reason is required'
            });
        }

        // Ensure comment exists (via Prisma)
        const comment = await prisma.comment.findUnique({
            where: { id: commentId },
            select: { id: true, post_id: true, commentor_id: true }
        });
        
        console.log('Comment found for reporting:', comment);
        
        if (!comment) {
            console.log('Comment not found for reporting:', commentId);
            return res.status(404).json({
                status: 'error',
                message: 'Comment not found'
            });
        }

        // Increment comment report count (via Prisma)
        await prisma.comment.update({
            where: { id: commentId },
            data: { comment_reports: { increment: 1 } }
        });

        console.log('Comment report count incremented');

        // Optional: notify admins with reason
        const admins = await prisma.admin.findMany({ select: { username: true } });
        console.log('Notifying admins:', admins.length);
        
        for (const admin of admins) {
            // Check if admin username exists in users table before creating notification
            const user = await prisma.user.findUnique({
                where: { username: admin.username },
                select: { username: true }
            });
            
            // Only create notification if admin has a corresponding user record
            if (user) {
                await prisma.notification.create({
                    data: {
                        userID: admin.username,
                        message: `Comment ${commentId} reported: ${reason}${description ? ` - ${description}` : ''}`,
                        type: 'comment_report',
                        isRead: false
                    }
                });
            } else {
                console.log(`Skipping notification for admin ${admin.username} - no corresponding user record found`);
            }
        }

        console.log('Admin notifications sent');

        res.json({
            status: 'success',
            message: 'Comment reported successfully',
            data: { reason: String(reason).trim(), description: description ? String(description) : null }
        });
    } catch (error) {
        console.error('Comment report error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error reporting comment',
            details: error.message
        });
    }
};

/**
 * Get all comments on the logged-in user's posts for the Inbox page
 */
exports.getUserPostComments = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const fromDate = req.query.from ? new Date(req.query.from) : null;

        const whereClause = {
            post: { user_id: userId },
            ...(fromDate && !isNaN(fromDate.getTime()) ? { comment_date: { gte: fromDate } } : {})
        };

        const [comments, total] = await Promise.all([
            prisma.comment.findMany({
                where: whereClause,
                select: {
                    comment_id: true,
                    comment_date: true,
                    comment_text: true,
                    post: {
                        select: {
                            id: true,
                            title: true,
                            video_url: true
                        }
                    },
                    user: {
                        select: {
                            id: true,
                            username: true,
                            profile_picture: true
                        }
                    }
                },
                orderBy: { comment_date: 'desc' },
                take: limit,
                skip: offset
            }),
            prisma.comment.count({ where: whereClause })
        ]);

        const formattedComments = comments.map(c => ({
            id: c.id,
            postId: c.post.id,
            postTitle: c.post.title,
            postThumbnail: c.post.video_url,
            content: c.comment_text,
            createdAt: c.comment_date,
            user: {
                id: c.user.id,
                name: c.user.username,
                username: c.user.username,
                avatar: c.user.profile_picture || null
            }
        }));

        res.json({
            status: 'success',
            data: {
                comments: formattedComments,
                pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
            }
        });
    } catch (error) {
        console.error('Error fetching user post comments:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch comments'
        });
    }
}; 