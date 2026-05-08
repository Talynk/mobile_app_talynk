const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate } = require('../middleware/auth');

// Import controllers
const viewController = require('../controllers/viewController');

// View routes
router.post('/posts/:postId', viewController.recordView); // No auth required for anonymous views
router.get('/posts/:postId/stats', viewController.getPostViewStats);
router.get('/posts/:postId/milestones', viewController.getPostMilestones);
router.get('/trending', viewController.getTrendingPosts);
router.post('/batch-update', authenticate, viewController.batchUpdateViewCounts); // Admin only

module.exports = router;
