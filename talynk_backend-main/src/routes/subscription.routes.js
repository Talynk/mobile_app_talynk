const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate } = require('../middleware/auth');

// Import controllers
const subscriptionController = require('../controllers/subscriptionController');

// Subscription routes
router.post('/:userID', authenticate, subscriptionController.subscribe);
router.delete('/:userId', authenticate, subscriptionController.unsubscribe);
router.get('/subscribers', authenticate, subscriptionController.getSubscribers);

module.exports = router;
