const prisma = require('../lib/prisma');
const { sendOTPEmail, sendPasswordResetEmail, sendPasswordChangeOTPEmail, sendAccountDeletionOTPEmail } = require('./emailService');

/**
 * Generate a 6-digit OTP code
 * @returns {string} - 6-digit OTP code
 */
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Create and send OTP for email verification
 * @param {string} email - Email address
 * @param {string} type - OTP type (EMAIL_VERIFICATION, PASSWORD_RESET, LOGIN)
 * @param {string} userId - Optional user ID if user exists
 * @returns {Promise<Object>} - OTP record
 */
exports.createAndSendOTP = async (email, type = 'EMAIL_VERIFICATION', userId = null) => {
    try {
        // Clean up expired OTPs for this email and type
        await prisma.otp.deleteMany({
            where: {
                email: email.toLowerCase(),
                type: type,
                expires_at: {
                    lt: new Date()
                }
            }
        });

        // Check for recent OTP requests (rate limiting)
        const recentOTP = await prisma.otp.findFirst({
            where: {
                email: email.toLowerCase(),
                type: type,
                verified: false,
                expires_at: {
                    gt: new Date()
                },
                createdAt: {
                    gte: new Date(Date.now() - 60000) // 1 minute ago
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        if (recentOTP) {
            // Calculate time remaining until they can request again
            const timeSinceLastRequest = Date.now() - recentOTP.createdAt.getTime();
            const waitTimeMs = 60000; // 1 minute
            const remainingTimeMs = waitTimeMs - timeSinceLastRequest;
            const remainingSeconds = Math.ceil(remainingTimeMs / 1000);
            
            const error = new Error('Please wait before requesting another OTP code');
            error.code = 'RATE_LIMIT_EXCEEDED';
            error.remainingSeconds = remainingSeconds;
            throw error;
        }

        // Generate OTP
        const otpCode = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // Create OTP record
        const otp = await prisma.otp.create({
            data: {
                email: email.toLowerCase(),
                code: otpCode,
                type: type,
                expires_at: expiresAt,
                user_id: userId
            }
        });

        // Send email based on type
        if (type === 'EMAIL_VERIFICATION') {
            await sendOTPEmail(email, otpCode);
        } else if (type === 'PASSWORD_RESET') {
            await sendPasswordResetEmail(email, otpCode);
        } else if (type === 'PASSWORD_CHANGE') {
            await sendPasswordChangeOTPEmail(email, otpCode);
        } else if (type === 'ACCOUNT_DELETION') {
            await sendAccountDeletionOTPEmail(email, otpCode);
        } else {
            await sendOTPEmail(email, otpCode); // Default to verification email
        }

        return otp;
    } catch (error) {
        console.error('OTP creation error:', error);
        throw error;
    }
};

/**
 * Verify OTP code
 * @param {string} email - Email address
 * @param {string} code - OTP code to verify
 * @param {string} type - OTP type
 * @returns {Promise<Object>} - OTP record if valid
 */
exports.verifyOTP = async (email, code, type = 'EMAIL_VERIFICATION') => {
    try {
        const otp = await prisma.otp.findFirst({
            where: {
                email: email.toLowerCase(),
                code: code,
                type: type,
                verified: false,
                expires_at: {
                    gt: new Date()
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        if (!otp) {
            // Check if OTP exists but is expired
            const expiredOTP = await prisma.otp.findFirst({
                where: {
                    email: email.toLowerCase(),
                    code: code,
                    type: type,
                    verified: false
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });

            if (expiredOTP && expiredOTP.expires_at < new Date()) {
                const error = new Error('OTP code has expired. Please request a new one.');
                error.code = 'OTP_EXPIRED';
                throw error;
            }

            // Check if OTP was already used
            const usedOTP = await prisma.otp.findFirst({
                where: {
                    email: email.toLowerCase(),
                    code: code,
                    type: type,
                    verified: true
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });

            if (usedOTP) {
                const error = new Error('This OTP code has already been used. Please request a new one.');
                error.code = 'OTP_ALREADY_USED';
                throw error;
            }

            const error = new Error('Invalid OTP code. Please check and try again.');
            error.code = 'INVALID_OTP';
            throw error;
        }

        // Mark OTP as verified
        await prisma.otp.update({
            where: { id: otp.id },
            data: { verified: true }
        });

        // Clean up old OTPs for this email
        await prisma.otp.deleteMany({
            where: {
                email: email.toLowerCase(),
                type: type,
                verified: true,
                id: {
                    not: otp.id
                }
            }
        });

        return otp;
    } catch (error) {
        console.error('OTP verification error:', error);
        throw error;
    }
};

/**
 * Clean up expired OTPs (can be run as a cron job)
 */
exports.cleanupExpiredOTPs = async () => {
    try {
        const result = await prisma.otp.deleteMany({
            where: {
                expires_at: {
                    lt: new Date()
                }
            }
        });
        console.log(`Cleaned up ${result.count} expired OTPs`);
        return result;
    } catch (error) {
        console.error('OTP cleanup error:', error);
        throw error;
    }
};

