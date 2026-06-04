const prisma = require('../lib/prisma');
const { emitEvent } = require('../lib/realtime');
const { clearCacheByPattern } = require('../utils/cache');

/**
 * Create a notification for the followed user
 */
const createFollowNotification = async (followerId, followingId) => {
  try {
    // Get follower's username and profile picture for the notification
    const follower = await prisma.user.findUnique({
      where: { id: followerId },
      select: { id: true, username: true, profile_picture: true }
    });
    
    if (!follower) return;
    
    // Get the username of the user being followed (userID must be username, not user ID)
    const followingUser = await prisma.user.findUnique({
      where: { id: followingId },
      select: { id: true, username: true }
    });
    
    if (!followingUser?.username) return;
    
    // Create notification for the followed user with additional context data
    const notification = await prisma.notification.create({
      data: {
        userID: followingUser.username,
        message: `${follower.username} started following you`,
        type: 'follow',
        isRead: false,
        actorId: follower.id  // User who followed
      }
    });
    
    // Emit real-time notification event
    emitEvent('notification:created', {
      userId: followingUser.id,
      userID: followingUser.username,
      notification: {
        id: notification.id,
        type: notification.type,
        message: notification.message,
        isRead: notification.isRead,
        createdAt: notification.createdAt
      }
    });
    
    console.log(`Notification created: ${follower.username} followed user ${followingUser.username}`);
  } catch (error) {
    console.error('Error creating follow notification:', error);
  }
};

// Follow a user with the userId in the request body
const followUser = async (req, res) => {
  try {
    const followerId = req.user.id;
    const { userId: followingId } = req.body;

    // Validate input
    if (!followingId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required'
      });
    }

    // Check if user is trying to follow themselves
    if (followerId === followingId) {
      return res.status(400).json({
        status: 'error',
        message: 'You cannot follow yourself'
      });
    }

    // Check if the user to follow exists
    const userToFollow = await prisma.user.findFirst({
      where: {
        id: followingId,
        status: 'active'
      },
      select: { id: true }
    });

    if (!userToFollow) {
      return res.status(404).json({
        status: 'error',
        message: 'User to follow not found or account is inactive'
      });
    }

    // Check if already following
    const existingFollow = await prisma.follow.findFirst({
      where: {
        followerId: followerId,
        followingId: followingId
      }
    });

    if (existingFollow) {
      return res.status(400).json({
        status: 'error',
        message: 'You are already following this user'
      });
    }

    // Create new follow relationship and update follower count in a transaction
    await prisma.$transaction(async (tx) => {
      // Create follow relationship
      await tx.follow.create({
        data: {
          followerId: followerId,
          followingId: followingId
        }
      });

      // Update follower count for the followed user
      await tx.user.update({
        where: { id: followingId },
        data: {
          follower_count: {
            increment: 1
          }
        }
      });
    });

    // Create a notification for the followed user
    await createFollowNotification(followerId, followingId);

    // Invalidate feed caches so following posts reflect the new follow
    await clearCacheByPattern('following_posts');
    await clearCacheByPattern('feed:');

    res.status(200).json({
      status: 'success',
      message: 'Successfully followed user',
      data: { isFollowing: true, followingId }
    });
  } catch (error) {
    console.error('Error following user:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error while processing follow request'
    });
  }
};

// Unfollow a user (followingId from URL param; body.userId supported for backward compatibility)
const unfollowUser = async (req, res) => {
  try {
    const followerId = req.user.id;
    const followingId = req.params.followingId || req.body?.userId;

    // Validate input
    if (!followingId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required (use URL path /follows/:followingId or body.userId)'
      });
    }

    // Check if user is trying to unfollow themselves (no-op allowed but we still validate)
    if (followerId === followingId) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot unfollow yourself'
      });
    }

    // Check if the follow relationship exists
    const follow = await prisma.follow.findFirst({
      where: {
        followerId: followerId,
        followingId: followingId
      }
    });

    if (!follow) {
      return res.status(404).json({
        status: 'error',
        message: 'You are not following this user'
      });
    }

    // Delete the follow relationship and update follower count in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete follow relationship
      await tx.follow.delete({
        where: { id: follow.id }
      });

      // Update follower count for the unfollowed user (ensure it doesn't go below 0)
      const user = await tx.user.findUnique({
        where: { id: followingId },
        select: { follower_count: true }
      });

      await tx.user.update({
        where: { id: followingId },
        data: {
          follower_count: Math.max((user?.follower_count || 0) - 1, 0)
        }
      });
    });

    // Invalidate feed caches
    await clearCacheByPattern('following_posts');
    await clearCacheByPattern('feed:');

    res.status(200).json({
      status: 'success',
      message: 'Successfully unfollowed user',
      data: { isFollowing: false, followingId }
    });
  } catch (error) {
    console.error('Error unfollowing user:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error while processing unfollow request'
    });
  }
};

// Get followers list with more complete user data and isFollowing flag
const getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Get total count
    const totalCount = await prisma.follow.count({
      where: { followingId: userId }
    });

    // Find followers with pagination
    const follows = await prisma.follow.findMany({
      where: { followingId: userId },
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            profile_picture: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });

    // Check if current user is following each follower
    const followers = await Promise.all(
      follows.map(async (follow) => {
        let isFollowing = false;
        if (currentUserId) {
          const followCheck = await prisma.follow.findFirst({
            where: {
              followerId: currentUserId,
              followingId: follow.follower.id
            }
          });
          isFollowing = !!followCheck;
        }

        return {
          id: follow.follower.id,
          username: follow.follower.username,
          profile_picture: follow.follower.profile_picture,
          isVerified: follow.follower.role === 'admin' || follow.follower.role === 'approver',
          isFollowing: isFollowing
        };
      })
    );

    const hasMore = offset + followers.length < totalCount;

    res.status(200).json({
      status: 'success',
      data: {
        followers,
        hasMore,
        totalCount
      }
    });
  } catch (error) {
    console.error('Error getting followers:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error while retrieving followers'
    });
  }
};

// Get following list with more complete user data and isFollowing flag
const getFollowing = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const currentUserId = req.user ? req.user.id : null;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Get total count
    const totalCount = await prisma.follow.count({
      where: { followerId: userId }
    });

    // Find following with pagination
    const follows = await prisma.follow.findMany({
      where: { followerId: userId },
      include: {
        following: {
          select: {
            id: true,
            username: true,
            profile_picture: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });

    // Check if current user is following each user in the following list
    const following = await Promise.all(
      follows.map(async (follow) => {
        let isFollowing = false;
        if (currentUserId) {
          const followCheck = await prisma.follow.findFirst({
            where: {
              followerId: currentUserId,
              followingId: follow.following.id
            }
          });
          isFollowing = !!followCheck;
        }

        return {
          id: follow.following.id,
          username: follow.following.username,
          profile_picture: follow.following.profile_picture,
          isVerified: follow.following.role === 'admin' || follow.following.role === 'approver',
          isFollowing: isFollowing
        };
      })
    );

    const hasMore = offset + following.length < totalCount;

    res.status(200).json({
      status: 'success',
      data: {
        following,
        hasMore,
        totalCount
      }
    });
  } catch (error) {
    console.error('Error getting following:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error while retrieving following users'
    });
  }
};

// Check if current user is following another user
const checkFollowStatus = async (req, res) => {
  try {
    const followerId = req.user.id;
    const { followingId } = req.params;

    if (!followingId) {
      return res.status(400).json({
        status: 'error',
        message: 'followingId is required'
      });
    }

    // Optionally validate that the target user exists
    const targetUser = await prisma.user.findFirst({
      where: { id: followingId, status: 'active' },
      select: { id: true }
    });
    if (!targetUser) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    const follow = await prisma.follow.findFirst({
      where: {
        followerId: followerId,
        followingId: followingId
      }
    });

    res.status(200).json({
      status: 'success',
      data: {
        isFollowing: !!follow,
        followingId
      }
    });
  } catch (error) {
    console.error('Error checking follow status:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error while checking follow status'
    });
  }
};

module.exports = {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  checkFollowStatus
};
