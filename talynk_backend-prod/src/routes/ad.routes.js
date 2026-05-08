const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/isAdmin');

// Import controllers
const adController = require('../controllers/adController');

// Ad routes
router.get('/', authenticate, adController.getActiveAds);
router.delete('/:adId', authenticate, isAdmin, adController.deleteAd);

module.exports = router;
