const prisma = require('../lib/prisma');

exports.errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Handle Prisma validation errors
    if (err && err.name === 'PrismaClientValidationError') {
        return res.status(400).json({
            status: 'error',
            message: 'Validation error',
            error: err.message
        });
    }
    
    // Handle RangeNotSatisfiableError (HTTP 416)
    if (err && (err.name === 'RangeNotSatisfiableError' || err.status === 416)) {
        return res.status(416).json({
            status: 'error',
            message: 'Range not satisfiable'
        });
    }

    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            status: 'error',
            message: 'Invalid token'
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            status: 'error',
            message: 'Token expired'
        });
    }

    // Default error
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode);
    res.json({
        status: 'error',
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack
    });
};

// Not found handler
exports.notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

module.exports = exports.errorHandler; 