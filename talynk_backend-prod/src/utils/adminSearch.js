/**
 * Admin search utilities: Prisma where clauses for Post (content) and Challenge.
 * Multi-term, multi-field, type-tolerant; reuses normalizeQuery/getSearchTerms from userSearch.
 */

const { normalizeQuery, getSearchTerms, parsePagination } = require('./userSearch');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Build Prisma where for one term matching Post or its user (author).
 * @param {string} term
 * @returns {object} Prisma where fragment for Post
 */
function buildPostTermCondition(term) {
    const safe = String(term).trim();
    if (!safe) return null;
    const conditions = [
        { title: { contains: safe, mode: 'insensitive' } },
        { description: { contains: safe, mode: 'insensitive' } },
        { content: { contains: safe, mode: 'insensitive' } },
        { user: { OR: [
            { username: { contains: safe, mode: 'insensitive' } },
            { display_name: { contains: safe, mode: 'insensitive' } },
            { email: { contains: safe, mode: 'insensitive' } }
        ] } }
    ];
    if (UUID_REGEX.test(safe)) {
        conditions.push({ id: safe });
        conditions.push({ user_id: safe });
    }
    return { OR: conditions };
}

/**
 * Build full Prisma where for Post model (content search).
 * Multi-term: each term must match at least one of title, description, content, id, user_id, or user (username, display_name, email).
 * @param {*} query - Search text (q or search param).
 * @param {object} options - Optional filters
 * @param {string} [options.status] - Post status (active, draft, suspended)
 * @param {boolean|string} [options.is_ad] - Filter by is_ad
 * @param {number|string} [options.category_id] - Filter by category_id
 * @param {string} [options.user_id] - Filter by user_id
 * @param {string|Date} [options.dateFrom] - createdAt >= dateFrom
 * @param {string|Date} [options.dateTo] - createdAt <= dateTo
 * @param {boolean|string} [options.hasReports] - report_count > 0
 * @param {boolean} [options.excludeAds] - If true, is_ad: false
 * @returns {object} Prisma where for Post
 */
function buildPostSearchWhere(query, options = {}) {
    const where = {};
    const terms = getSearchTerms(query);
    if (terms.length > 0) {
        const termConditions = terms.map(t => buildPostTermCondition(t)).filter(Boolean);
        if (termConditions.length === 1) {
            Object.assign(where, termConditions[0]);
        } else if (termConditions.length > 1) {
            where.AND = termConditions;
        }
    }
    if (options.status != null && String(options.status).trim()) {
        where.status = String(options.status).trim();
    }
    if (options.is_ad !== undefined && options.is_ad !== null) {
        where.is_ad = options.is_ad === true || String(options.is_ad).toLowerCase() === 'true';
    }
    if (options.excludeAds === true) {
        where.is_ad = false;
    }
    if (options.category_id != null) {
        const n = parseInt(options.category_id, 10);
        if (!Number.isNaN(n)) where.category_id = n;
    }
    if (options.user_id != null && String(options.user_id).trim()) {
        where.user_id = String(options.user_id).trim();
    }
    if (options.hasReports === true || String(options.hasReports).toLowerCase() === 'true') {
        where.report_count = { gt: 0 };
    }
    if (options.dateFrom != null || options.dateTo != null) {
        where.createdAt = {};
        if (options.dateFrom != null) {
            const d = new Date(options.dateFrom);
            if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
        }
        if (options.dateTo != null) {
            const d = new Date(options.dateTo);
            if (!Number.isNaN(d.getTime())) where.createdAt.lte = d;
        }
        if (Object.keys(where.createdAt).length === 0) delete where.createdAt;
    }
    return Object.keys(where).length === 0 ? {} : where;
}

/**
 * Build Prisma where for one term matching Challenge or its organizer.
 * @param {string} term
 * @returns {object} Prisma where fragment for Challenge
 */
function buildChallengeTermCondition(term) {
    const safe = String(term).trim();
    if (!safe) return null;
    const conditions = [
        { name: { contains: safe, mode: 'insensitive' } },
        { description: { contains: safe, mode: 'insensitive' } },
        { organizer_name: { contains: safe, mode: 'insensitive' } },
        { contact_email: { contains: safe, mode: 'insensitive' } },
        { organizer: { OR: [
            { username: { contains: safe, mode: 'insensitive' } },
            { display_name: { contains: safe, mode: 'insensitive' } },
            { email: { contains: safe, mode: 'insensitive' } }
        ] } }
    ];
    if (UUID_REGEX.test(safe)) {
        conditions.push({ id: safe });
        conditions.push({ organizer_id: safe });
    }
    return { OR: conditions };
}

/**
 * Build full Prisma where for Challenge model.
 * Multi-term: each term must match at least one of name, description, organizer_name, contact_email, id, organizer_id, or organizer (username, display_name, email).
 * @param {*} query - Search text (q or search param).
 * @param {object} options - Optional filters
 * @param {string} [options.status] - Challenge status (pending, approved, active, stopped, ended, rejected)
 * @param {string|Date} [options.dateFrom] - createdAt >= dateFrom (or start_date)
 * @param {string|Date} [options.dateTo] - createdAt <= dateTo (or end_date)
 * @returns {object} Prisma where for Challenge
 */
function buildChallengeSearchWhere(query, options = {}) {
    const where = {};
    const terms = getSearchTerms(query);
    if (terms.length > 0) {
        const termConditions = terms.map(t => buildChallengeTermCondition(t)).filter(Boolean);
        if (termConditions.length === 1) {
            Object.assign(where, termConditions[0]);
        } else if (termConditions.length > 1) {
            where.AND = termConditions;
        }
    }
    if (options.status != null && String(options.status).trim()) {
        where.status = String(options.status).trim();
    }
    if (options.dateFrom != null || options.dateTo != null) {
        where.createdAt = {};
        if (options.dateFrom != null) {
            const d = new Date(options.dateFrom);
            if (!Number.isNaN(d.getTime())) where.createdAt.gte = d;
        }
        if (options.dateTo != null) {
            const d = new Date(options.dateTo);
            if (!Number.isNaN(d.getTime())) where.createdAt.lte = d;
        }
        if (Object.keys(where.createdAt).length === 0) delete where.createdAt;
    }
    return Object.keys(where).length === 0 ? {} : where;
}

module.exports = {
    buildPostSearchWhere,
    buildChallengeSearchWhere,
    buildPostTermCondition,
    buildChallengeTermCondition,
    parsePagination: (page, limit, opts) => parsePagination(page, limit, opts),
    normalizeQuery
};
