const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate } = require('../middleware/auth');

// Import controllers
const commentController = require('../controllers/commentController');

// Comment routes
router.post('/:postId/comments', authenticate, commentController.addComment);
router.get('/:postId/comments', commentController.getPostComments);
router.delete('/comments/:commentId', authenticate, commentController.deleteComment);
router.post('/comments/:commentId/report', authenticate, commentController.reportComment);

module.exports = router;




