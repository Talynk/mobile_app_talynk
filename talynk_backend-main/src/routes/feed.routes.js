const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const feedController = require('../controllers/feedController');

router.get('/public', feedController.getPublicFeed);
router.get('/personalized', authenticate, feedController.getPersonalizedFeed);

module.exports = router;
