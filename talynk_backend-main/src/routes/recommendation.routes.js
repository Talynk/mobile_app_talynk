const express = require('express');
const router = express.Router();
const recommendationController = require('../controllers/recommendationController');
const { authenticate } = require('../middleware/auth');

// Get personalized feed for user
router.get('/feed', authenticate, recommendationController.getPersonalizedFeed);

// Get trending posts
router.get('/trending', recommendationController.getTrendingPosts);

// Get recommended categories for user
router.get('/categories', authenticate, recommendationController.getRecommendedCategories);

// Record user interaction with post
router.post('/interactions/:postId', authenticate, recommendationController.recordInteraction);

module.exports = router;
