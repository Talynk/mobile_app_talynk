/**
 * Country resolver — maps ISO 3166-1 alpha-2 codes (e.g. "RW", "US") to the
 * `Country` row stored in the database. Used by the geoLocation middleware and
 * the OTP / registration flow to translate an IP-derived country code into the
 * country object the frontend can pre-fill.
 *
 * The lookup table is loaded lazily and refreshed periodically so country
 * additions / activations on the admin side propagate without a server restart.
 *
 * NOTE: `Country.code` is stored upper-case (e.g. "RW"); we normalise lookup
 * keys to upper-case before resolving to be tolerant of caller casing.
 */

const prisma = require('../lib/prisma');

const REFRESH_INTERVAL_MS = Number(process.env.COUNTRY_CACHE_TTL_MS) || 60 * 60 * 1000; // 1h
const CF_SPECIAL_CODES = new Set(['XX', 'T1']);

let cache = null;
let cacheLoadedAt = 0;
let inflightLoad = null;

/**
 * @typedef {Object} ResolvedCountry
 * @property {number}  id
 * @property {string}  code         ISO 3166-1 alpha-2
 * @property {string}  name
 * @property {string|null} phone_code
 * @property {string|null} flag_emoji
 */

/**
 * Build the in-memory code → country map from the DB. Inactive countries are
 * intentionally excluded — if a country was deactivated by an admin we do not
 * want to silently set new users to it.
 *
 * @returns {Promise<Map<string, ResolvedCountry>>}
 */
async function loadCache() {
    const rows = await prisma.country.findMany({
        where: { is_active: true },
        select: {
            id: true,
            code: true,
            name: true,
            phone_code: true,
            flag_emoji: true
        }
    });

    const next = new Map();
    for (const row of rows) {
        if (!row.code) continue;
        next.set(String(row.code).toUpperCase(), {
            id: row.id,
            code: row.code,
            name: row.name,
            phone_code: row.phone_code || null,
            flag_emoji: row.flag_emoji || null
        });
    }
    return next;
}

async function ensureCache() {
    const now = Date.now();
    if (cache && now - cacheLoadedAt < REFRESH_INTERVAL_MS) {
        return cache;
    }
    if (inflightLoad) {
        return inflightLoad;
    }

    inflightLoad = loadCache()
        .then((next) => {
            cache = next;
            cacheLoadedAt = Date.now();
            return cache;
        })
        .catch((err) => {
            // Don't poison the cache on transient DB errors — keep serving the
            // last known good map (if any) and let the next call retry.
            console.error('[countryResolver] Failed to load country cache:', err.message);
            return cache || new Map();
        })
        .finally(() => {
            inflightLoad = null;
        });

    return inflightLoad;
}

/**
 * Resolve an alpha-2 country code to the cached country row.
 * Returns `null` for missing, unknown, or Cloudflare-special codes (`XX`, `T1`).
 *
 * @param {string|null|undefined} code
 * @returns {Promise<ResolvedCountry|null>}
 */
async function resolveByCode(code) {
    if (!code || typeof code !== 'string') return null;
    const normalized = code.trim().toUpperCase();
    if (!normalized || CF_SPECIAL_CODES.has(normalized)) return null;

    const map = await ensureCache();
    return map.get(normalized) || null;
}

/**
 * Force a refresh on the next lookup. Useful after admin operations that add or
 * activate countries.
 */
function invalidateCache() {
    cache = null;
    cacheLoadedAt = 0;
}

module.exports = {
    resolveByCode,
    invalidateCache,
    CF_SPECIAL_CODES
};
