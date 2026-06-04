const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');

// Import controllers
const userController = require('../controllers/userController');

// User routes (all protected)
router.get('/profile', authenticate, userController.getProfile);
router.put('/profile', authenticate, ...upload.single('user_facial_image'), userController.updateProfile);
router.put('/interests', authenticate, userController.updateUserInterests);
router.put('/country', authenticate, userController.updateUserCountry);
router.get('/statistics', authenticate, userController.getStatistics);
router.get('/searches', authenticate, userController.getRecentSearches);
router.post('/searches', authenticate, userController.addSearchTerm);
router.put('/notifications', authenticate, userController.toggleNotifications);
router.get('/notifications', authenticate, userController.getNotifications);
router.put('/notifications/read-all', authenticate, userController.markAllNotificationsAsRead);
router.put('/notifications/:notificationId/read', authenticate, userController.markNotificationAsRead);
router.delete('/notifications/:notificationId', authenticate, userController.deleteNotification);
router.delete('/notifications', authenticate, userController.deleteAllNotifications);

// Session management for current user
router.get('/sessions', authenticate, userController.getUserSessions);
router.delete('/sessions/:sessionId', authenticate, userController.revokeUserSession);

// Public user profile routes
router.get('/:id', userController.getUserProfileById);
router.get('/:id/posts', userController.getUserPostsById);
router.get('/:id/posts/approved', userController.getUserApprovedPosts);

module.exports = router;