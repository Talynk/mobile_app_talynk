/**
 * Authentication utility functions for flexible email/username login
 */

/**
 * Determines if a string looks like an email
 * @param {string} input - The input string to check
 * @returns {boolean} - True if input looks like an email
 */
const isEmail = (input) => {
    if (!input || typeof input !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
};

/**
 * Determines if a string looks like a username
 * @param {string} input - The input string to check
 * @returns {boolean} - True if input looks like a username
 */
const isUsername = (input) => {
    if (!input || typeof input !== 'string') return false;
    return /^[a-zA-Z0-9_-]{3,30}$/.test(input);
};

/**
 * Auto-detects whether an input is an email or username
 * @param {string} input - The input string to analyze
 * @returns {string} - 'email', 'username', or 'unknown'
 */
const detectLoginType = (input) => {
    if (isEmail(input)) return 'email';
    if (isUsername(input)) return 'username';
    return 'unknown';
};

/**
 * Builds a Prisma where clause for flexible login
 * @param {string} loginValue - The login value (email or username)
 * @param {string} loginType - The type of login ('email' or 'username')
 * @param {object} additionalWhere - Additional where conditions
 * @returns {object} - Prisma where clause
 */
const buildLoginWhereClause = (loginValue, loginType, additionalWhere = {}) => {
    const whereClause = { ...additionalWhere };
    
    if (loginType === 'email') {
        whereClause.email = loginValue;
    } else if (loginType === 'username') {
        whereClause.username = loginValue;
    } else {
        // If type is unknown, try both
        whereClause.OR = [
            { email: loginValue },
            { username: loginValue }
        ];
    }
    
    return whereClause;
};

/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid email format
 */
const validateEmail = (email) => {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * Validates username format
 * @param {string} username - Username to validate
 * @returns {boolean} - True if valid username format
 */
const validateUsername = (username) => {
    if (!username) return false;
    return /^[a-zA-Z0-9_-]{3,30}$/.test(username);
};

/**
 * Validates that at least one of email or username is provided and valid
 * @param {string} email - Email to validate
 * @param {string} username - Username to validate
 * @returns {object} - Validation result with isValid and errors
 */
const validateLoginFields = (email, username) => {
    const errors = [];
    
    if (!email && !username) {
        errors.push('Either email or username must be provided');
        return { isValid: false, errors };
    }
    
    if (email && !validateEmail(email)) {
        errors.push('Invalid email format');
    }
    
    if (username && !validateUsername(username)) {
        errors.push('Username must be 3-30 characters long and contain only letters, numbers, underscores, and hyphens');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

/**
 * Sanitizes login input by trimming whitespace and converting to lowercase for email
 * @param {string} input - Input to sanitize
 * @param {string} type - Type of input ('email' or 'username')
 * @returns {string} - Sanitized input
 */
const sanitizeLoginInput = (input, type) => {
    if (!input || typeof input !== 'string') return '';
    
    let sanitized = input.trim();
    
    if (type === 'email') {
        sanitized = sanitized.toLowerCase();
    }
    
    return sanitized;
};

/**
 * Creates a user-friendly error message for login conflicts
 * @param {object} existingUser - The existing user object
 * @param {string} providedEmail - The email that was provided
 * @param {string} providedUsername - The username that was provided
 * @returns {string} - User-friendly error message
 */
const createConflictMessage = (existingUser, providedEmail, providedUsername) => {
    if (existingUser.email === providedEmail) {
        return 'Email already exists';
    }
    if (existingUser.username === providedUsername) {
        return 'Username already exists';
    }
    return 'User already exists';
};

module.exports = {
    isEmail,
    isUsername,
    detectLoginType,
    buildLoginWhereClause,
    validateEmail,
    validateUsername,
    validateLoginFields,
    sanitizeLoginInput,
    createConflictMessage
};
