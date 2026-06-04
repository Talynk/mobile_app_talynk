const express = require('express');
const router = express.Router();
const featuredController = require('../controllers/featuredController');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/isAdmin');

// Get featured posts
router.get('/', featuredController.getFeaturedPosts);

// Get all featured posts (Admin only)
router.get('/admin', authenticate, isAdmin, featuredController.getAllFeaturedPosts);

// Feature a post (Admin only)
router.post('/posts/:postId', authenticate, isAdmin, featuredController.featurePost);

// Unfeature a post (Admin only)
router.delete('/posts/:postId', authenticate, isAdmin, featuredController.unfeaturePost);

module.exports = router;
