const prisma = require('../lib/prisma');
const { emitEvent } = require('../lib/realtime');
const adminNotificationService = require('../services/adminNotificationService');

/**
 * User Suspension Service
 * Automatically suspends users when they have 3+ suspended posts
 */

const SUSPENDED_POSTS_THRESHOLD = 3;

/**
 * Check if user should be automatically suspended
 * and suspend them if threshold is reached
 * 
 * @param {string} userId - User ID to check
 * @param {string} postId - Post ID that was just suspended (optional)
 * @returns {Promise<{suspended: boolean, suspendedPostsCount: number}>}
 */
const checkAndSuspendUser = async (userId, postId = null) => {
    try {
        if (!userId) {
            return { suspended: false, suspendedPostsCount: 0 };
        }

        // Count suspended posts for this user
        const suspendedPostsCount = await prisma.post.count({
            where: {
                user_id: userId,
                status: 'suspended'
            }
        });

        // Get user info
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                email: true,
                status: true
            }
        });

        if (!user) {
            return { suspended: false, suspendedPostsCount };
        }

        // Check if user should be suspended
        if (suspendedPostsCount >= SUSPENDED_POSTS_THRESHOLD && user.status === 'active') {
            const autoReason = `Automatically suspended due to ${suspendedPostsCount} suspended posts. Please contact support for review.`;
            // Suspend the user
            await prisma.user.update({
                where: { id: userId },
                data: {
                    status: 'suspended',
                    suspended_at: new Date(),
                    suspension_reason: autoReason
                }
            });

            emitEvent('user:account_suspended', {
                userId,
                reason: autoReason,
                suspended_at: new Date()
            });

            // Create notification for the user
            if (user.username) {
                const notification = await prisma.notification.create({
                    data: {
                        userID: user.username,
                        message: `Your account has been automatically suspended due to ${suspendedPostsCount} suspended posts. Please contact support for review.`,
                        type: 'account_suspended',
                        isRead: false
                    }
                });

                // Emit real-time notification
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
            }

            // Notify admin portal
            adminNotificationService.create({
                severity: 'critical',
                category: 'security',
                title: 'User auto-suspended',
                message: `User ${user.username || user.email} automatically suspended due to ${suspendedPostsCount} suspended posts.`,
                actionUrl: `/admin/users/${userId}`,
                metadata: { userId, suspendedPostsCount },
            }).catch((err) => console.error('[User Suspension] Admin notification error:', err));

            // Log for admin review
            console.log(`[User Suspension] User ${user.username} (${userId}) automatically suspended due to ${suspendedPostsCount} suspended posts`);

            return {
                suspended: true,
                suspendedPostsCount,
                message: `User automatically suspended due to ${suspendedPostsCount} suspended posts`
            };
        }

        return {
            suspended: false,
            suspendedPostsCount,
            message: suspendedPostsCount >= SUSPENDED_POSTS_THRESHOLD 
                ? 'User already suspended' 
                : `User has ${suspendedPostsCount} suspended posts (threshold: ${SUSPENDED_POSTS_THRESHOLD})`
        };

    } catch (error) {
        console.error('[User Suspension] Error checking/suspending user:', error);
        return {
            suspended: false,
            suspendedPostsCount: 0,
            error: error.message
        };
    }
};

/**
 * Get suspended posts count for a user
 * 
 * @param {string} userId - User ID
 * @returns {Promise<number>}
 */
const getSuspendedPostsCount = async (userId) => {
    try {
        return await prisma.post.count({
            where: {
                user_id: userId,
                status: 'suspended'
            }
        });
    } catch (error) {
        console.error('[User Suspension] Error getting suspended posts count:', error);
        return 0;
    }
};

module.exports = {
    checkAndSuspendUser,
    getSuspendedPostsCount,
    SUSPENDED_POSTS_THRESHOLD
};
