const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate } = require('../middleware/auth');

// Import controllers
const suggestionController = require('../controllers/suggestionController');

// User suggestion routes
router.get('/users/suggestions/mutual', authenticate, suggestionController.getMutualSuggestions);
router.get('/users/suggestions/discover', authenticate, suggestionController.getDiscoverSuggestions);

module.exports = router;
