/**
 * geoLocation middleware — derives the visitor's country from the inbound
 * request and attaches a small geo summary to `req.geo`.
 *
 * Resolution priority:
 *   1. Cloudflare's `CF-IPCountry` header (when the zone has IP Geolocation or
 *      the "Add visitor location headers" Managed Transform enabled). Two
 *      special values are filtered out per Cloudflare docs:
 *        - "XX" — no data
 *        - "T1" — Tor exit node
 *   2. Offline `geoip-lite` lookup against the resolved client IP.
 *   3. `null` — caller decides how to fall back (e.g. require manual selection).
 *
 * The client IP is taken from (in order): `CF-Connecting-IP`, the first hop of
 * `X-Forwarded-For`, or `req.ip` (which honours `app.set('trust proxy', true)`).
 *
 * Disable by setting `ENABLE_IP_COUNTRY_DETECTION=false` — `req.geo` will still
 * be populated with `{ country_code: null, source: null }` so downstream
 * handlers don't need to null-check `req.geo`.
 *
 * Refs:
 *   - https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-ipcountry
 *   - https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip
 *   - https://developers.cloudflare.com/network/ip-geolocation/
 */

let geoip = null;
try {
    geoip = require('geoip-lite');
} catch (err) {
    console.warn('[geoLocation] geoip-lite is not installed — fallback disabled.');
}

const { CF_SPECIAL_CODES } = require('../services/countryResolver');

const FEATURE_FLAG_KEY = 'ENABLE_IP_COUNTRY_DETECTION';
const PRIVATE_IP_REGEX = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.|169\.254\.|::1$|fc00:|fd[0-9a-f]{2}:|fe80:)/i;

function isFeatureEnabled() {
    const raw = process.env[FEATURE_FLAG_KEY];
    if (raw === undefined) return true;
    return String(raw).toLowerCase() !== 'false' && raw !== '0';
}

function pickCloudflareCountry(req) {
    const raw = req.headers['cf-ipcountry'];
    if (!raw) return null;
    const code = String(raw).trim().toUpperCase();
    if (!code || CF_SPECIAL_CODES.has(code)) return null;
    return code;
}

function pickClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp && typeof cfIp === 'string') {
        const trimmed = cfIp.trim();
        if (trimmed) return trimmed;
    }

    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        const first = typeof xff === 'string' ? xff.split(',')[0] : xff[0];
        if (first) {
            const trimmed = String(first).trim();
            if (trimmed) return trimmed;
        }
    }

    return req.ip || req.socket?.remoteAddress || null;
}

function lookupCountryByIp(ip) {
    if (!ip || !geoip) return null;
    if (PRIVATE_IP_REGEX.test(ip)) return null;
    try {
        const result = geoip.lookup(ip);
        if (!result || !result.country) return null;
        return String(result.country).toUpperCase();
    } catch (err) {
        console.warn('[geoLocation] geoip-lite lookup failed:', err.message);
        return null;
    }
}

function geoLocationMiddleware(req, _res, next) {
    if (!isFeatureEnabled()) {
        req.geo = { ip: null, country_code: null, source: null };
        return next();
    }

    const ip = pickClientIp(req);

    const cfCountry = pickCloudflareCountry(req);
    if (cfCountry) {
        req.geo = { ip, country_code: cfCountry, source: 'cloudflare' };
        return next();
    }

    const fallbackCountry = lookupCountryByIp(ip);
    if (fallbackCountry) {
        req.geo = { ip, country_code: fallbackCountry, source: 'geoip-lite' };
        return next();
    }

    req.geo = { ip, country_code: null, source: null };
    return next();
}

module.exports = geoLocationMiddleware;
module.exports.pickClientIp = pickClientIp;
module.exports.pickCloudflareCountry = pickCloudflareCountry;
module.exports.lookupCountryByIp = lookupCountryByIp;
module.exports.isFeatureEnabled = isFeatureEnabled;
