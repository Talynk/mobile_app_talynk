const rateLimit = require('express-rate-limit');

// Create memory store rate limiters
const createLimiter = (windowMs, max, message) => {
    return rateLimit({
        windowMs,
        max,
        message: { status: 'error', message },
        standardHeaders: true,
        legacyHeaders: false
    });
};

exports.rateLimiters = {
    login: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 attempts
        message: { status: 'error', message: 'Too many login attempts' }
    }),
    
    register: rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 3, // 3 attempts
        message: { status: 'error', message: 'Too many registration attempts' }
    }),
    
    upload: rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 10, // 10 uploads
        message: { status: 'error', message: 'Upload limit reached' }
    }),

    accountDeletionPublicRequest: createLimiter(
        15 * 60 * 1000,
        5,
        'Too many account deletion OTP requests. Please try again later.'
    ),

    accountDeletionPublicConfirm: createLimiter(
        15 * 60 * 1000,
        10,
        'Too many account deletion confirmation attempts. Please try again later.'
    ),
    
    api: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // 100 requests
        message: { status: 'error', message: 'Too many requests' }
    })
}; 