/**
 * Redis-backed seen post IDs for feed deduplication (24h sliding TTL).
 */

const { getClient, redisReady } = require('../../lib/redis');

const TTL_SEC =
    (parseInt(process.env.FEED_SEEN_TTL_HOURS || '24', 10) || 24) * 3600;
const MAX_SEEN = parseInt(process.env.FEED_SEEN_MAX_SIZE || '2000', 10) || 2000;

function keyUser(userId) {
    return `feed:seen:u:${userId}`;
}

function keyGuest(deviceFingerprint) {
    return `feed:seen:g:${deviceFingerprint}`;
}

async function getSeenIds(key) {
    if (!redisReady()) return new Set();
    try {
        const redis = getClient();
        const ids = await redis.smembers(key);
        return new Set(ids || []);
    } catch (e) {
        console.warn('[seenSet] getSeenIds:', e.message);
        return new Set();
    }
}

async function addSeen(key, postIds) {
    if (!redisReady() || !postIds?.length) return;
    try {
        const redis = getClient();
        const pipe = redis.pipeline();
        for (const id of postIds) {
            if (id) pipe.sadd(key, id);
        }
        pipe.expire(key, TTL_SEC);
        await pipe.exec();

        const n = await redis.scard(key);
        if (n > MAX_SEEN) {
            const excess = n - MAX_SEEN;
            const members = await redis.srandmember(key, excess);
            if (members?.length) await redis.srem(key, ...members);
        }
    } catch (e) {
        console.warn('[seenSet] addSeen:', e.message);
    }
}

async function clearSeen(key) {
    if (!redisReady()) return;
    try {
        await getClient().del(key);
    } catch (e) {
        console.warn('[seenSet] clearSeen:', e.message);
    }
}

module.exports = {
    keyUser,
    keyGuest,
    getSeenIds,
    addSeen,
    clearSeen,
    TTL_SEC,
    MAX_SEEN
};
