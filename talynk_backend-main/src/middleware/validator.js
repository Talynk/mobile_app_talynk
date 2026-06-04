const { body, param, validationResult } = require('express-validator');

exports.validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            status: 'error',
            errors: errors.array()
        });
    }
    next();
};

exports.registerValidation = [
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
        .withMessage('Password must be at least 6 characters long'),
    body('phone1')
        .optional()
        .matches(/^\+?[\d\s-]{10,15}$/)
        .withMessage('Invalid phone number format'),
    body('phone2')
        .optional()
        .matches(/^\+?[\d\s-]{10,15}$/)
        .withMessage('Invalid phone number format')
];

exports.postValidation = [
    body('title')
        .trim()
        .notEmpty()
        .withMessage('Title is required'),
    body('post_category')
        .trim()
        .notEmpty()
        .withMessage('Category is required'),
    body('caption')
        .optional()
        .trim()
];

exports.commentValidation = [
    body('commentText')
        .trim()
        .notEmpty()
        .withMessage('Comment text is required')
];

exports.idValidation = [
    param('id')
        .isInt()
        .withMessage('Invalid ID format')
]; 