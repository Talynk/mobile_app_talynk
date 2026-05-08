const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

// Import middleware
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');
const { rateLimiters } = require('../middleware/rateLimiter');

// Import controllers
const authController = require('../controllers/authController');

// Auth routes
router.post('/login', authController.login);
router.post('/register', authController.register); // Legacy endpoint (deprecated)

// New OTP-based registration flow
router.post('/register/request-otp', authController.requestRegistrationOTP);
router.post('/register/verify-otp', authController.verifyRegistrationOTP);
router.post('/register/complete', authController.completeRegistration);

// Password reset flow
router.post('/password-reset/request-otp', authController.requestPasswordResetOTP);
router.post('/password-reset/verify-otp', authController.verifyPasswordResetOTP);
router.post('/password-reset/reset', authController.resetPassword);

// Logged-in password change flow (requires current password + email OTP)
router.post('/password/change/request-otp', authenticate, authController.requestPasswordChangeOTP);
router.post('/password/change/verify-otp', authenticate, authController.verifyPasswordChangeOTP);

router.post('/refresh-token', authController.refreshToken);
// Protected auth routes
router.get('/profile', authenticate, authController.getProfile);
router.put('/profile', authenticate, authController.updateProfile);

// Logout routes (with session tracking)
router.post('/logout', authenticate, authController.logout);
router.post('/logout/all', authenticate, authController.logoutAll);

// Account deletion (requires authentication)
router.post('/account/delete/request-otp', authenticate, authController.requestAccountDeletionOTP);
router.post('/account/delete', authenticate, authController.deleteAccount);

// Public account deletion flow for app-store external URL
const publicDeletionVerifyLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    message: {
        status: 'error',
        message: 'Too many OTP verification attempts. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

router.post('/account-deletion/public/request-otp', rateLimiters.accountDeletionPublicRequest, authController.requestPublicAccountDeletionOTP);
router.post('/account-deletion/public/verify-otp', publicDeletionVerifyLimiter, authController.verifyPublicAccountDeletionOTP);
router.post('/account-deletion/public/confirm', rateLimiters.accountDeletionPublicConfirm, authController.confirmPublicAccountDeletion);

module.exports = router;