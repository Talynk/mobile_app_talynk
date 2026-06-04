const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const adminController = require('../controllers/adminController');
const adminLogsController = require('../controllers/adminLogsController');
const supportEmailController = require('../controllers/supportEmailController');
const adminNotificationsController = require('../controllers/adminNotificationsController');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/isAdmin');
const seedController = require('../controllers/seedController');
const upload = require('../middleware/fileUpload');

// Admin registration (no authentication required for initial setup)
router.post('/register', adminController.registerAdmin);

// Admin routes (all require authentication and admin privileges)
router.get('/users', authenticate, isAdmin, adminController.getAllUsers);
router.get('/users/suspended', authenticate, isAdmin, adminController.getSuspendedUsers);
// Place the aggregate stats route before the :userId route so /users/stats does not match :userId = "stats"
router.get('/users/stats', authenticate, isAdmin, adminController.getUserStats);
router.get('/users/:userId', authenticate, isAdmin, adminController.getAdminUserById);
router.get('/users/:userId/activity', authenticate, isAdmin, adminController.getAdminUserActivity);
router.get('/users/:userId/posts', authenticate, isAdmin, adminController.getAdminUserPosts);
router.get('/users/:userId/posts/engagement', authenticate, isAdmin, adminController.getAdminUserPostsEngagement);
router.post('/accounts/manage', authenticate, isAdmin, adminController.manageUserAccount);
router.post('/approvers', authenticate, isAdmin, adminController.registerApprover);
router.get('/approvers', authenticate, isAdmin, adminController.getApprovers);
router.get('/approvers/:approverId', authenticate, isAdmin, adminController.getApproverDetails);
router.get('/approvers/:approverId/stats', authenticate, isAdmin, adminController.getApproverStats);
router.get('/approvers/:approverId/analytics', authenticate, isAdmin, adminController.getApproverAnalytics);
router.get('/approvers/:approverId/reviewed-posts', authenticate, isAdmin, adminController.getApproverReviewedPosts);
router.get('/approvers/:approverId/posts', authenticate, isAdmin, adminController.getAllApprovedPostsByApprover);
router.put('/approvers/:id/suspend', authenticate, isAdmin, adminController.suspendApprover);
router.put('/approvers/:id/deactivate', authenticate, isAdmin, adminController.deactivateApprover);
router.put('/approvers/:id/activate', authenticate, isAdmin, adminController.activateApprover);
router.delete('/approvers/:id', authenticate, isAdmin, adminController.removeApprover);
router.get('/videos', authenticate, isAdmin, adminController.getAllVideos);
router.put('/approve', authenticate, isAdmin, adminController.updatePostStatus);
router.get('/approved/posts', authenticate, isAdmin, adminController.getApprovedPosts);
router.get('/posts/pending', authenticate, isAdmin, adminController.getPendingPosts);
router.get('/posts/rejected', authenticate, isAdmin, adminController.getRejectedPosts);
router.get('/posts/flagged', authenticate, isAdmin, adminController.getFlaggedPosts);
router.get('/approvers/:approverId/approved-posts', authenticate, isAdmin, adminController.getAllApprovedPostsByApprover);
router.get('/dashboard/stats', authenticate, isAdmin, adminController.getDashboardStats);
router.get('/stats/overview', authenticate, isAdmin, adminController.getAdminOverviewStats);
router.get('/search', authenticate, isAdmin, adminController.adminUnifiedSearch);
router.get('/posts/search', authenticate, isAdmin, adminController.searchPosts);

// ===== NEW ADMIN ANALYTICS & MANAGEMENT ROUTES =====

// Analytics & Reports
router.get('/analytics', authenticate, isAdmin, adminController.getAnalytics);
router.get('/content-management/stats', authenticate, isAdmin, adminController.getContentManagementStats);

// Logs, Audit & Device Tracking
router.get('/logs/activity', authenticate, isAdmin, adminLogsController.getActivityLogs);
router.get('/logs/activity/:id', authenticate, isAdmin, adminLogsController.getActivityLogById);
router.get('/logs/traces/:traceId', authenticate, isAdmin, adminLogsController.getActivityLogsByTraceId);
router.get('/logs/audit', authenticate, isAdmin, adminLogsController.getAuditLogs);
router.get('/devices', authenticate, isAdmin, adminLogsController.getDevices);
router.get('/devices/:deviceFingerprintId/activity', authenticate, isAdmin, adminLogsController.getDeviceActivity);

// Support email inbox
router.get('/support/emails', authenticate, isAdmin, supportEmailController.listEmails);
router.get('/support/emails/stats', authenticate, isAdmin, supportEmailController.getStats);
router.get('/support/emails/:id', authenticate, isAdmin, supportEmailController.getEmailById);
router.patch('/support/emails/:id/read', authenticate, isAdmin, supportEmailController.markRead);
router.patch('/support/emails/read-all', authenticate, isAdmin, supportEmailController.markAllRead);

// User sessions (admin view)
router.get('/users/:userId/sessions', authenticate, isAdmin, adminController.getUserSessions);
router.post('/users/:userId/sessions/:sessionId/revoke', authenticate, isAdmin, adminController.revokeUserSession);

// Post Management (fixed paths before :postId)
router.get('/posts/all', authenticate, isAdmin, adminController.getAdminAllPosts);
router.get('/posts/analytics', authenticate, isAdmin, adminController.getAdminPosts);
router.get('/posts/processing', authenticate, isAdmin, adminController.getPostsProcessing);
router.post('/posts/processing/reconcile-from-cdn', authenticate, isAdmin, adminController.reconcileVideoPostsFromCdn);
router.post('/posts/processing/requeue-stuck', authenticate, isAdmin, adminController.bulkRequeueStuckVideoJobs);
router.post('/posts/upload-stale/fail', authenticate, isAdmin, adminController.failStaleUploadingPosts);
router.get('/posts/:postId', authenticate, isAdmin, adminController.getAdminPostById);
router.get('/posts/:postId/engagement', authenticate, isAdmin, adminController.getPostEngagement);
router.put('/posts/:postId/featured', authenticate, isAdmin, adminController.setPostFeatured);
router.put('/posts/:postId/freeze', authenticate, isAdmin, adminController.freezePost);
router.put('/posts/:postId/unfreeze', authenticate, isAdmin, adminController.unfreezePost);
router.put('/posts/:postId/suspend', authenticate, isAdmin, adminController.suspendPost);
router.delete('/posts/:postId', authenticate, isAdmin, adminController.adminDeletePost);
router.get('/posts/:postId/reports', authenticate, isAdmin, adminController.getPostReports);
router.get('/settings/post-report-threshold', authenticate, isAdmin, adminController.getPostReportSuspendThreshold);
router.put('/settings/post-report-threshold', authenticate, isAdmin, adminController.updatePostReportSuspendThreshold);

// Appeals Management
router.get('/appeals', authenticate, isAdmin, adminController.getAllAppeals);

// Admin notifications (list, stats, mark read)
router.get('/notifications/stats', authenticate, isAdmin, adminNotificationsController.getStats);
router.patch('/notifications/read-all', authenticate, isAdmin, adminNotificationsController.markAllRead);
router.get('/notifications', authenticate, isAdmin, adminNotificationsController.list);
router.get('/notifications/:id', authenticate, isAdmin, adminNotificationsController.getById);
router.patch('/notifications/:id/read', authenticate, isAdmin, adminNotificationsController.markRead);

// Notifications (broadcast / send to user)
router.post('/notifications/broadcast', authenticate, isAdmin, adminController.sendBroadcastNotification);
router.post('/notifications/send/:userId', authenticate, isAdmin, adminController.sendNotificationToUser);

// Challenge Management
router.get('/challenges', authenticate, isAdmin, adminController.getAllChallenges);
router.get('/challenges/pending', authenticate, isAdmin, adminController.getPendingChallenges);
router.get('/challenges/dashboard/stats', authenticate, isAdmin, adminController.getChallengeDashboardStats);
router.get('/challenges/growth-analytics', authenticate, isAdmin, adminController.getChallengeGrowthAnalytics);
router.get('/challenges/:challengeId', authenticate, isAdmin, adminController.getChallengeById);
router.get('/challenges/:challengeId/analytics', authenticate, isAdmin, adminController.getChallengeAnalytics);
router.put('/challenges/:challengeId/approve', authenticate, isAdmin, adminController.approveChallenge);
router.put('/challenges/:challengeId/reject', authenticate, isAdmin, adminController.rejectChallenge);
router.put('/challenges/:challengeId/stop', authenticate, isAdmin, adminController.stopChallenge);
router.put('/challenges/:challengeId/start-now', authenticate, isAdmin, adminController.startChallengeNow);
router.put('/challenges/:challengeId/dates', authenticate, isAdmin, adminController.updateChallengeDates);
router.put('/challenges/:challengeId/winners/reorder', authenticate, isAdmin, adminController.reorderChallengeWinners);
router.put('/challenges/:challengeId/winners/confirm', authenticate, isAdmin, adminController.confirmChallengeWinners);
router.get('/challenges/:challengeId/winners/aggregated', authenticate, isAdmin, adminController.getAggregatedChallengeWinners);
router.get('/challenges/:challengeId/participants/ranking', authenticate, isAdmin, adminController.getChallengeParticipantsRanking);
router.put('/challenges/:challengeId/winners/config', authenticate, isAdmin, adminController.updateChallengeWinnersConfig);

// Ads (admin-only; signed-URL flow first, then multipart legacy, then CRUD)
router.post('/ads/create-upload', authenticate, isAdmin, adminController.createAdUpload);
router.post('/ads/upload-complete', authenticate, isAdmin, adminController.completeAdUpload);
router.post('/ads', authenticate, isAdmin, ...upload.single('file'), adminController.createAd);
router.get('/ads', authenticate, isAdmin, adminController.listAds);
router.get('/ads/:adId', authenticate, isAdmin, adminController.getAdById);
router.put('/ads/:adId', authenticate, isAdmin, adminController.updateAd);
router.delete('/ads/:adId', authenticate, isAdmin, adminController.deleteAd);






// Seeding and reset endpoints (Admin only)
router.post('/seed/countries', authenticate, isAdmin, seedController.seedCountries);
router.post('/seed/categories', authenticate, isAdmin, seedController.seedCategories);
router.post('/seed/all', authenticate, isAdmin, seedController.seedAll);
router.delete('/reset/countries', authenticate, isAdmin, seedController.resetCountries);
router.delete('/reset/categories', authenticate, isAdmin, seedController.resetCategories);
router.delete('/reset/all', authenticate, isAdmin, seedController.resetAll);

module.exports = router; 