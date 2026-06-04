const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate, optionalAuthenticate } = require('../middleware/auth');

// Import controllers
const likeController = require('../controllers/likeController');

// Like routes
// Toggle like requires authentication
router.post('/posts/:postId/toggle', authenticate, likeController.toggleLike);
// Status endpoints support optional authentication (for unauthenticated users)
router.get('/posts/:postId/status', optionalAuthenticate, likeController.checkLikeStatus);
router.post('/posts/batch-status', optionalAuthenticate, likeController.batchCheckLikeStatus);
// Other routes
router.get('/posts/:postId/stats', likeController.getPostLikeStats);
// Public endpoint to get users who liked a post (no authentication required)
router.get('/posts/:postId/users', likeController.getPostLikes);
router.get('/user/liked', authenticate, likeController.getLikedPosts);

module.exports = router;
