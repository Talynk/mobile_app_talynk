const { body, param, query } = require('express-validator');

// User related validations
exports.userValidations = {
    profile: [
        body('phone1')
            .optional()
            .matches(/^\+?[\d\s-]{10,15}$/)
            .withMessage('Invalid phone number format'),
        body('phone2')
            .optional()
            .matches(/^\+?[\d\s-]{10,15}$/)
            .withMessage('Invalid phone number format'),
        body('selected_category')
            .optional()
            .trim()
            .notEmpty()
            .withMessage('Category cannot be empty if provided')
    ],
    
    notification: [
        body('notification')
            .isBoolean()
            .withMessage('Notification must be true or false')
    ]
};

// Post related validations
exports.postValidations = {
    create: [
        body('title')
            .trim()
            .isLength({ min: 3, max: 255 })
            .withMessage('Title must be between 3 and 255 characters'),
        body('caption')
            .optional()
            .trim()
            .isLength({ max: 1000 })
            .withMessage('Caption cannot exceed 1000 characters'),
        body('post_category')
            .trim()
            .notEmpty()
            .withMessage('Category is required')
    ],
    
    update: [
        param('postId')
            .isInt()
            .withMessage('Invalid post ID'),
        body('title')
            .optional()
            .trim()
            .isLength({ min: 3, max: 255 })
            .withMessage('Title must be between 3 and 255 characters'),
        body('caption')
            .optional()
            .trim()
            .isLength({ max: 1000 })
            .withMessage('Caption cannot exceed 1000 characters')
    ],
    
    pagination: [
        query('page')
            .optional()
            .isInt({ min: 1 })
            .withMessage('Page must be a positive integer'),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 50 })
            .withMessage('Limit must be between 1 and 50')
    ]
};

// Comment related validations
exports.commentValidations = {
    create: [
        param('postId')
            .isInt()
            .withMessage('Invalid post ID'),
        body('commentText')
            .trim()
            .isLength({ min: 1, max: 500 })
            .withMessage('Comment must be between 1 and 500 characters')
    ],
    
    report: [
        param('commentId')
            .isUUID()
            .withMessage('Invalid comment ID'),
        body('reason')
            .trim()
            .notEmpty()
            .withMessage('Report reason is required')
    ]
};

// Admin related validations
exports.adminValidations = {
    registerApprover: [
        body('username')
            .trim()
            .isLength({ min: 3, max: 255 })
            .withMessage('Username must be between 3 and 255 characters'),
        body('email')
            .isEmail()
            .normalizeEmail()
            .withMessage('Must be a valid email'),
        body('password')
            .isLength({ min: 6 })
            .matches(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/)
            .withMessage('Password must be at least 6 characters and contain both letters and numbers')
    ],
    
    manageAccount: [
        body('username')
            .trim()
            .notEmpty()
            .withMessage('Username is required'),
        body('action')
            .isIn(['freezed', 'deleted', 'active'])
            .withMessage('Invalid action type')
    ]
};

// Search validations
exports.searchValidations = [
    query('q')
        .trim()
        .isLength({ min: 2 })
        .withMessage('Search query must be at least 2 characters'),
    query('type')
        .optional()
        .isIn(['users', 'posts', 'comments'])
        .withMessage('Invalid search type')
]; 