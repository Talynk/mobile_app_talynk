const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/isAdmin');

// Public / user-facing support endpoints
router.post('/issues', authenticate, supportController.createIssue);
router.post('/issues/anonymous', supportController.createAnonymousIssue);
router.get('/issues/my', authenticate, supportController.getMyIssues);

// Admin support management
router.get('/admin/issues', authenticate, isAdmin, supportController.adminListIssues);
router.get('/admin/issues/:id', authenticate, isAdmin, supportController.adminGetIssueById);
router.put('/admin/issues/:id', authenticate, isAdmin, supportController.adminUpdateIssue);

module.exports = router;

