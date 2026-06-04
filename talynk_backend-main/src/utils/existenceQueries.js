const prisma = require('../lib/prisma');

/**
 * Fast existence query utilities
 * These functions use count() for boolean responses instead of fetching full records
 * Significantly improves performance for existence checks
 */

/**
 * Check if a user has liked a specific post
 * @param {string} userId - User ID
 * @param {string} postId - Post ID
 * @returns {Promise<boolean>} - True if user has liked the post
 */
exports.userHasLikedPost = async (userId, postId) => {
    const count = await prisma.postLike.count({
        where: {
            user_id: userId,
            post_id: postId
        }
    });
    return count > 0;
};

/**
 * Check if a user has viewed a specific post
 * @param {string} userId - User ID
 * @param {string} postId - Post ID
 * @returns {Promise<boolean>} - True if user has viewed the post
 */
exports.userHasViewedPost = async (userId, postId) => {
    const count = await prisma.view.count({
        where: {
            user_id: userId,
            post_id: postId
        }
    });
    return count > 0;
};

/**
 * Check if an IP address has viewed a specific post
 * @param {string} ipAddress - IP address
 * @param {string} postId - Post ID
 * @returns {Promise<boolean>} - True if IP has viewed the post
 */
exports.ipHasViewedPost = async (ipAddress, postId) => {
    const count = await prisma.view.count({
        where: {
            ip_address: ipAddress,
            post_id: postId
        }
    });
    return count > 0;
};

/**
 * Check if a user is following another user
 * @param {string} followerId - Follower user ID
 * @param {string} followingId - Following user ID
 * @returns {Promise<boolean>} - True if user is following
 */
exports.userIsFollowing = async (followerId, followingId) => {
    const count = await prisma.follow.count({
        where: {
            followerId: followerId,
            followingId: followingId
        }
    });
    return count > 0;
};

/**
 * Check if a user has reported a specific post
 * @param {string} userId - User ID
 * @param {string} postId - Post ID
 * @returns {Promise<boolean>} - True if user has reported the post
 */
exports.userHasReportedPost = async (userId, postId) => {
    const count = await prisma.postReport.count({
        where: {
            user_id: userId,
            post_id: postId
        }
    });
    return count > 0;
};

/**
 * Check if a user has subscribed to another user
 * @param {string} subscriberId - Subscriber user ID
 * @param {string} subscribedToId - Subscribed to user ID
 * @returns {Promise<boolean>} - True if user has subscribed
 */
exports.userHasSubscribed = async (subscriberId, subscribedToId) => {
    const count = await prisma.subscription.count({
        where: {
            subscriber_id: subscriberId,
            subscribed_to: subscribedToId
        }
    });
    return count > 0;
};

/**
 * Check if a post exists
 * @param {string} postId - Post ID
 * @returns {Promise<boolean>} - True if post exists
 */
exports.postExists = async (postId) => {
    const count = await prisma.post.count({
        where: {
            id: postId
        }
    });
    return count > 0;
};

/**
 * Check if a user exists
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - True if user exists
 */
exports.userExists = async (userId) => {
    const count = await prisma.user.count({
        where: {
            id: userId
        }
    });
    return count > 0;
};

/**
 * Check if a category exists
 * @param {string} categoryId - Category ID
 * @returns {Promise<boolean>} - True if category exists
 */
exports.categoryExists = async (categoryId) => {
    const count = await prisma.category.count({
        where: {
            id: parseInt(categoryId)
        }
    });
    return count > 0;
};

/**
 * Check if a post is featured
 * @param {string} postId - Post ID
 * @returns {Promise<boolean>} - True if post is featured
 */
exports.postIsFeatured = async (postId) => {
    const count = await prisma.featuredPost.count({
        where: {
            post_id: postId,
            is_active: true
        }
    });
    return count > 0;
};

/**
 * Check if a post is frozen
 * @param {string} postId - Post ID
 * @returns {Promise<boolean>} - True if post is frozen
 */
exports.postIsFrozen = async (postId) => {
    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { is_frozen: true }
    });
    return post?.is_frozen || false;
};

/**
 * Batch existence check for multiple posts
 * @param {string[]} postIds - Array of post IDs
 * @returns {Promise<Object>} - Object with postId as key and boolean as value
 */
exports.batchPostExists = async (postIds) => {
    const posts = await prisma.post.findMany({
        where: {
            id: {
                in: postIds
            }
        },
        select: {
            id: true
        }
    });
    
    const existingIds = new Set(posts.map(post => post.id));
    const result = {};
    
    postIds.forEach(postId => {
        result[postId] = existingIds.has(postId);
    });
    
    return result;
};

/**
 * Batch existence check for user likes on multiple posts
 * @param {string} userId - User ID
 * @param {string[]} postIds - Array of post IDs
 * @returns {Promise<Object>} - Object with postId as key and boolean as value
 */
exports.batchUserLikes = async (userId, postIds) => {
    const likes = await prisma.postLike.findMany({
        where: {
            user_id: userId,
            post_id: {
                in: postIds
            }
        },
        select: {
            post_id: true
        }
    });
    
    const likedPostIds = new Set(likes.map(like => like.post_id));
    const result = {};
    
    postIds.forEach(postId => {
        result[postId] = likedPostIds.has(postId);
    });
    
    return result;
};

/**
 * Get existence counts for multiple conditions
 * @param {Object} conditions - Object with condition names and their queries
 * @returns {Promise<Object>} - Object with condition names and their counts
 */
exports.batchExistenceCounts = async (conditions) => {
    const results = {};
    
    await Promise.all(
        Object.entries(conditions).map(async ([name, query]) => {
            const count = await prisma[query.model].count(query.where);
            results[name] = count;
        })
    );
    
    return results;
};
