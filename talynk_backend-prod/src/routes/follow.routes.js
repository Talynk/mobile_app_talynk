const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate } = require('../middleware/auth');

// Import controllers
const followController = require('../controllers/followController');
const postController = require('../controllers/postController');

// Follow / unfollow (authenticated)
// POST body: { userId } — user to follow
// DELETE :followingId — user to unfollow (ID in URL; no body required)
router.post('/', authenticate, followController.followUser);
router.delete('/:followingId', authenticate, followController.unfollowUser);

// Lists (getFollowers/getFollowing work with or without auth for isFollowing flag)
router.get('/users/:userId/followers', followController.getFollowers);
router.get('/users/:userId/following', followController.getFollowing);

// Check if current user follows another user
router.get('/check/:followingId', authenticate, followController.checkFollowStatus);

// Posts from users that the current user follows
router.get('/posts', authenticate, postController.getFollowingPosts);

module.exports = router;
