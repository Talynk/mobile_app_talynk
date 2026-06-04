const rateLimit = require('express-rate-limit');

// First, install the required packages:
// npm install express-rate-limit rate-limit-redis ioredis

// Using memory store instead of Redis
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        status: 'error',
        message: 'Too many requests, please try again later.'
    }
});

// Specific route limiters using memory store
exports.rateLimiters = {
    // Auth routes
    login: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 attempts per window
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            status: 'error',
            message: 'Too many login attempts. Please try again later.'
        }
    }),

    // Registration
    register: rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 3, // 3 registrations per hour
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            status: 'error',
            message: 'Too many registration attempts. Please try again later.'
        }
    }),

    // Video upload
    upload: rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 10, // 10 uploads per hour
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            status: 'error',
            message: 'Upload limit reached. Please try again later.'
        }
    }),

    // Search
    search: rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 10, // 10 searches per minute
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            status: 'error',
            message: 'Search limit reached. Please try again later.'
        }
    })
};

// Export the general limiter as well
exports.generalLimiter = limiter; 