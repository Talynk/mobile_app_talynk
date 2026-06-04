const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');

// Import controllers
const postController = require('../controllers/postController');
const likeController = require('../controllers/likeController');

// Post routes (all protected)
// Direct upload (signed URL) - client uploads to R2, then calls upload-complete
router.post('/create-upload', authenticate, postController.createVideoUpload);
router.post('/upload-complete', authenticate, postController.completeVideoUpload);
// Legacy: single request with file (file passes through backend)
router.post('/', authenticate, ...upload.single('file'), postController.createPost);

// SPECIFIC ROUTES FIRST - before parameterized routes
router.get('/user', authenticate, postController.getUserPosts);
router.get('/drafts', authenticate, postController.getUserDraftPosts);
router.get('/feed', authenticate, postController.getOptimizedFeed);
router.get('/all', postController.getAllPosts); // only approved
router.get('/search', postController.searchPosts);

// PARAMETERIZED ROUTES LAST - to avoid conflicts
router.put('/:postId/publish', authenticate, postController.publishDraftPost);
router.get('/:postId', postController.getPostById);
router.post('/:postId/like', authenticate, likeController.toggleLike);
router.delete('/:postId', authenticate, postController.deletePost);

// Video processing routes
router.get('/:postId/processing-status', postController.getVideoProcessingStatus);
router.post('/:postId/retry-processing', authenticate, postController.retryVideoProcessing);

module.exports = router;