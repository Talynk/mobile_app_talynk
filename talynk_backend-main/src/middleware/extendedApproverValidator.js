const { body, param, query } = require('express-validator');

exports.approverValidations = {
    // Post review validations
    postReview: [
        param('postId')
            .notEmpty()
            .withMessage('Post ID is required')
            .matches(/^[a-zA-Z0-9-_]+$/)
            .withMessage('Invalid post ID format'),
        body('notes')
            .optional()
            .isString()
            .trim()
            .isLength({ min: 10, max: 500 })
            .withMessage('Review notes must be between 10 and 500 characters')
            .matches(/^[a-zA-Z0-9\s.,!?-]+$/)
            .withMessage('Review notes contain invalid characters'),
        body('category')
            .optional()
            .isIn(['inappropriate', 'copyright', 'quality', 'other'])
            .withMessage('Invalid rejection category'),
        body('urgency')
            .optional()
            .isIn(['low', 'medium', 'high'])
            .withMessage('Invalid urgency level')
    ],

    // Query validations
    queryValidation: [
        query('page')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('Page must be between 1 and 100'),
        query('limit')
            .optional()
            .isInt({ min: 5, max: 50 })
            .withMessage('Limit must be between 5 and 50'),
        query('sortBy')
            .optional()
            .isIn(['date', 'title', 'uploader', 'category'])
            .withMessage('Invalid sort field'),
        query('order')
            .optional()
            .isIn(['asc', 'desc'])
            .withMessage('Invalid sort order'),
        query('dateRange')
            .optional()
            .isIn(['today', 'week', 'month', 'custom'])
            .withMessage('Invalid date range')
    ],

    // Date range validation
    dateRangeValidation: [
        query('startDate')
            .if(query('dateRange').equals('custom'))
            .isDate()
            .withMessage('Invalid start date'),
        query('endDate')
            .if(query('dateRange').equals('custom'))
            .isDate()
            .withMessage('Invalid end date')
            .custom((endDate, { req }) => {
                const startDate = new Date(req.query.startDate);
                const end = new Date(endDate);
                if (end <= startDate) {
                    throw new Error('End date must be after start date');
                }
                return true;
            })
    ],

    // Report generation validation
    reportValidation: [
        body('reportType')
            .isIn(['daily', 'weekly', 'monthly', 'custom'])
            .withMessage('Invalid report type'),
        body('format')
            .isIn(['pdf', 'csv', 'excel'])
            .withMessage('Invalid report format'),
        body('metrics')
            .isArray()
            .withMessage('Metrics must be an array')
            .custom((metrics) => {
                const validMetrics = ['approvals', 'rejections', 'pending', 'response_time'];
                return metrics.every(metric => validMetrics.includes(metric));
            })
            .withMessage('Invalid metrics selected')
    ]
}; 