const prisma = require('../lib/prisma');
const { emitEvent } = require('../lib/realtime');

/**
 * View Milestone Service
 * Tracks and notifies users when their posts reach view milestones
 */

// Define view milestones (can be configured)
const VIEW_MILESTONES = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

// Minimum time after post creation before milestone notifications (in hours)
const MIN_MILESTONE_NOTIFICATION_DELAY_HOURS = 1;

/**
 * Get the next milestone that hasn't been notified
 */
const getNextMilestone = (currentViews, notifiedMilestones) => {
    return VIEW_MILESTONES.find(milestone => 
        currentViews >= milestone && !notifiedMilestones.includes(milestone)
    );
};

/**
 * Check if post is old enough for milestone notifications
 */
const isPostEligibleForMilestone = (postCreatedAt) => {
    const now = new Date();
    const postAge = (now - new Date(postCreatedAt)) / (1000 * 60 * 60); // hours
    return postAge >= MIN_MILESTONE_NOTIFICATION_DELAY_HOURS;
};

/**
 * Format milestone message
 */
const formatMilestoneMessage = (views) => {
    if (views >= 1000000) {
        return `🎉 Amazing! Your post reached ${(views / 1000000).toFixed(1)}M views!`;
    } else if (views >= 1000) {
        return `🎉 Congratulations! Your post reached ${(views / 1000).toFixed(views >= 10000 ? 0 : 1)}K views!`;
    } else {
        return `🎉 Great! Your post reached ${views} views!`;
    }
};

/**
 * Check and notify view milestone
 * This is called asynchronously after a view is recorded
 * 
 * @param {string} postId - Post ID
 * @param {number} currentViews - Current view count
 * @param {string} postOwnerId - Post owner user ID
 */
const checkAndNotifyMilestone = async (postId, currentViews, postOwnerId) => {
    try {
        if (!postOwnerId) {
            return; // No owner, skip
        }

        // Get post details
        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: {
                id: true,
                title: true,
                views: true,
                createdAt: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        notification: true
                    }
                }
            }
        });

        if (!post || !post.user) {
            return;
        }

        // Check if user has notifications enabled
        if (!post.user.notification) {
            return;
        }

        // Check if post is old enough for milestone notifications
        if (!isPostEligibleForMilestone(post.createdAt)) {
            return;
        }

        // Get notified milestones for this post from Redis or DB
        // For simplicity, we'll use a JSON field or check notifications
        // Let's check if we've already notified for this milestone
        const milestone = getNextMilestone(currentViews, []);

        if (!milestone) {
            return; // No new milestone reached
        }

        // Check if we've already notified for this milestone
        // We'll check existing notifications to avoid duplicates
        const existingNotification = await prisma.notification.findFirst({
            where: {
                userID: post.user.username,
                type: 'view_milestone',
                message: {
                    contains: `${milestone} views`
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        if (existingNotification) {
            // Check if it's for the same post (by checking recent notifications)
            const recentNotification = await prisma.notification.findFirst({
                where: {
                    userID: post.user.username,
                    type: 'view_milestone',
                    createdAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });

            // If we notified recently and views haven't increased significantly, skip
            if (recentNotification) {
                const recentViews = parseInt(recentNotification.message.match(/\d+/)?.[0] || '0');
                if (currentViews < recentViews * 1.1) { // Less than 10% increase
                    return;
                }
            }
        }

        // Create milestone notification
        const message = formatMilestoneMessage(milestone);
        const notificationMessage = `${message} - "${post.title || 'Your post'}"`;

        const notification = await prisma.notification.create({
            data: {
                userID: post.user.username,
                message: notificationMessage,
                type: 'view_milestone',
                isRead: false,
                postId: post.id  // Post that reached the milestone
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
                createdAt: notification.createdAt,
                metadata: {
                    postId: post.id,
                    postTitle: post.title,
                    milestone: milestone,
                    views: currentViews
                }
            }
        });

        console.log(`[View Milestone] Notified user ${post.user.username} for ${milestone} views on post ${postId}`);

    } catch (error) {
        console.error('[View Milestone] Error checking milestone:', error);
        // Don't throw - this is a background operation
    }
};

/**
 * Get milestone statistics for a post
 */
const getPostMilestones = async (postId) => {
    try {
        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: {
                views: true,
                createdAt: true
            }
        });

        if (!post) {
            return null;
        }

        const reachedMilestones = VIEW_MILESTONES.filter(m => post.views >= m);
        const nextMilestone = VIEW_MILESTONES.find(m => post.views < m);

        return {
            currentViews: post.views,
            reachedMilestones,
            nextMilestone,
            progressToNext: nextMilestone 
                ? ((post.views / nextMilestone) * 100).toFixed(1)
                : 100
        };
    } catch (error) {
        console.error('[View Milestone] Error getting milestones:', error);
        return null;
    }
};

module.exports = {
    checkAndNotifyMilestone,
    getPostMilestones,
    VIEW_MILESTONES
};
