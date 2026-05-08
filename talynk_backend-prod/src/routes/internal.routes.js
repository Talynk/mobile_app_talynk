const express = require('express');
const router = express.Router();
const { videoProcessingCallback, getPendingVideoPosts } = require('../controllers/internalController');
const { authenticateInternalAPI } = require('../middleware/internalAuth');

/**
 * Internal API Routes
 * These routes are called by internal services (e.g., video processor VPS)
 * Requires INTERNAL_API_KEY authentication
 */

// Video processor: get posts pending HLS transcoding (polling mode)
router.get('/pending-videos', authenticateInternalAPI, getPendingVideoPosts);

// Video processor: callback after processing (both Redis and polling mode)
router.post('/video-callback', authenticateInternalAPI, videoProcessingCallback);

module.exports = router;
