const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/isAdmin');

// Report a post
router.post('/posts/:postId', authenticate, reportController.reportPost);

// Get all reports (Admin only)
router.get('/', authenticate, isAdmin, reportController.getAllReports);

// Get reports for a specific post
router.get('/posts/:postId', authenticate, reportController.getPostReports);

// Review a report (Admin only)
router.put('/:reportId/review', authenticate, isAdmin, reportController.reviewReport);

// Get report statistics (Admin only)
router.get('/stats', authenticate, isAdmin, reportController.getReportStats);

// Appeal routes
// Appeal a flagged post
router.post('/posts/:postId/appeal', authenticate, reportController.appealPost);

// Get user's appeals
router.get('/appeals/my', authenticate, reportController.getUserAppeals);

// Get all appeals (Admin only)
router.get('/appeals', authenticate, isAdmin, reportController.getAllAppeals);

// Review an appeal (Admin only)
router.put('/appeals/:appealId/review', authenticate, isAdmin, reportController.reviewAppeal);

module.exports = router;

