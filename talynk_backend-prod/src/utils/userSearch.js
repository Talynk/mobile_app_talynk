/**
 * User search utilities: build Prisma where clauses for User model.
 * Type-tolerant, supports multi-term and multi-field search, and optional filters.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Normalize a search query to a non-empty string or null.
 * Tolerates null, undefined, numbers; trims and collapses whitespace.
 * @param {*} input - Raw query (string, number, etc.)
 * @returns {string|null}
 */
function normalizeQuery(input) {
    if (input == null) return null;
    const s = String(input).replace(/\s+/g, ' ').trim();
    return s.length > 0 ? s : null;
}

/**
 * Split a query string into search terms (by spaces), normalized and non-empty.
 * @param {string} query
 * @returns {string[]}
 */
function getSearchTerms(query) {
    const q = normalizeQuery(query);
    if (!q) return [];
    return q.split(/\s+/).map(t => t.trim()).filter(Boolean);
}

/**
 * Build Prisma where condition for a single term: match if term appears in any of the fields.
 * Uses contains + mode insensitive for text; exact match for UUID id.
 * @param {string} term
 * @returns {object} Prisma where fragment for User
 */
function buildTermCondition(term) {
    const safe = String(term).trim();
    if (!safe) return null;
    const conditions = [
        { username: { contains: safe, mode: 'insensitive' } },
        { display_name: { contains: safe, mode: 'insensitive' } },
        { email: { contains: safe, mode: 'insensitive' } },
        { bio: { contains: safe, mode: 'insensitive' } },
        { phone1: { contains: safe, mode: 'insensitive' } },
        { phone2: { contains: safe, mode: 'insensitive' } }
    ];
    if (UUID_REGEX.test(safe)) {
        conditions.push({ id: safe });
    }
    return { OR: conditions };
}

/**
 * Build full Prisma where object for User model from search query and optional filters.
 * - Multi-term: each term must match at least one field (AND of OR-blocks).
 * - Type-tolerant: query can be string/number/null; filters are coerced safely.
 * @param {*} query - Search text (q or search param). Can be string, number, null.
 * @param {object} options - Optional filters
 * @param {string} [options.status] - User status (active, suspended, frozen, etc.)
 * @param {string} [options.role] - User role (user, admin, etc.)
 * @param {string|Date} [options.dateFrom] - createdAt >= dateFrom
 * @param {string|Date} [options.dateTo] - createdAt <= dateTo
 * @param {boolean|string} [options.suspended] - If true/'true', restrict to status suspended
 * @param {number|string} [options.country_id] - Filter by country_id
 * @returns {object} Prisma where for User (can be merged or used in relation user: { ... })
 */
function buildUserSearchWhere(query, options = {}) {
    const where = {};
    const terms = getSearchTerms(query);
    if (terms.length > 0) {
        const termConditions = terms.map(t => buildTermCondition(t)).filter(Boolean);
        if (termConditions.length === 1) {
            Object.assign(where, termConditions[0]);
        } else if (termConditions.length > 1) {
            where.AND = termConditions;
        }
    }
    // Targeted filters (type-tolerant)
    if (options.status != null && String(options.status).trim()) {
        where.status = String(options.status).trim();
    }
    if (options.role != null && String(options.role).trim()) {
        where.role = String(options.role).trim();
    }
    if (options.country_id != null) {
        const n = parseInt(options.country_id, 10);
        if (!Number.isNaN(n)) where.country_id = n;
    }
    if (options.suspended === true || String(options.suspended).toLowerCase() === 'true') {
        where.status = 'suspended';
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
 * Parse pagination params from query. Type-tolerant.
 * @param {*} page
 * @param {*} limit
 * @param {{ maxLimit?: number }} opts
 * @returns {{ pageNum: number, limitNum: number, offset: number }}
 */
function parsePagination(page, limit, opts = {}) {
    const maxLimit = opts.maxLimit != null ? opts.maxLimit : 100;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(maxLimit, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;
    return { pageNum, limitNum, offset };
}

module.exports = {
    normalizeQuery,
    getSearchTerms,
    buildTermCondition,
    buildUserSearchWhere,
    parsePagination
};
