const express = require('express');
const router = express.Router();
const challengeController = require('../controllers/challengeController');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');

// ===== PUBLIC ROUTES (No authentication required) =====

// Get all approved/active challenges (public - accessible to unauthenticated users)
router.get('/', challengeController.getAllChallenges);

// Get active challenges (public - accessible to unauthenticated users)
router.get('/active', challengeController.getActiveChallenges);

// Get ended challenges (public - accessible to unauthenticated users)
router.get('/ended', challengeController.getEndedChallenges);

// Challenge Statistics Endpoints (must be before parameterized routes)
router.get('/stats/overview', challengeController.getChallengeStatistics);
router.get('/stats/most-participants', challengeController.getChallengesWithMostParticipants);
router.get('/stats/most-posts', challengeController.getChallengesWithMostPosts);
router.get('/stats/most-rewarding', challengeController.getMostRewardingChallenges);
router.get('/stats/top-organizers', challengeController.getUsersWithMostChallenges);

// Fixed-path GET routes (must be before /:challengeId so "joined" and "my-challenges" are not treated as IDs)
router.get('/my-challenges', authenticate, challengeController.getMyChallenges);
router.get('/joined', authenticate, challengeController.getJoinedChallenges);

// Get a single challenge by ID (public - accessible to unauthenticated users)
router.get('/:challengeId', optionalAuthenticate, challengeController.getChallengeById);

// Get participants of a challenge (public - accessible to unauthenticated users)
router.get('/:challengeId/participants', challengeController.getChallengeParticipants);

// Participants ranking by total likes (public/mobile)
router.get('/:challengeId/participants/ranking', challengeController.getChallengeParticipantsRanking);
// Posts submitted by a participant in a challenge (any participant, before or after winners confirmation)
router.get('/:challengeId/participants/:userId/posts', challengeController.getChallengeParticipantPosts);

// Get posts for a challenge (public - accessible to unauthenticated users)
router.get('/:challengeId/posts', challengeController.getChallengePosts);

// Aggregated winners per user (public/mobile)
router.get('/:challengeId/winners', challengeController.getAggregatedChallengeWinners);

// Drill-down: posts for a specific winner (user) in a challenge
router.get('/:challengeId/winners/:userId/posts', challengeController.getChallengeWinnerUserPosts);

// ===== PROTECTED ROUTES (Authentication required) =====

// Create a new challenge request
router.post('/', authenticate, challengeController.createChallenge);

// Edit a challenge (only while pending, organizer only)
router.put('/:challengeId', authenticate, challengeController.updateChallenge);

// Join a challenge
router.post('/:challengeId/join', authenticate, challengeController.joinChallenge);

// Create a post directly in a challenge (with file upload)
router.post('/:challengeId/posts', authenticate, upload.single('file'), challengeController.createPostInChallenge);

// Link an existing post to a challenge
router.post('/:challengeId/posts/:postId', authenticate, challengeController.linkPostToChallenge);

module.exports = router;

