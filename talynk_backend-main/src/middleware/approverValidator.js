const { body, param, query } = require('express-validator');

exports.approverValidations = {
    postReview: [
        param('postId')
            .notEmpty()
            .withMessage('Post ID is required'),
        body('notes')
            .optional()
            .isString()
            .trim()
            .isLength({ max: 500 })
            .withMessage('Review notes cannot exceed 500 characters')
    ],

    postQuery: [
        query('page')
            .optional()
            .isInt({ min: 1 })
            .withMessage('Page must be a positive integer'),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 50 })
            .withMessage('Limit must be between 1 and 50'),
        query('search')
            .optional()
            .isString()
            .trim()
            .isLength({ max: 100 })
            .withMessage('Search query cannot exceed 100 characters'),
        query('date')
            .optional()
            .isDate()
            .withMessage('Invalid date format')
    ]
}; 