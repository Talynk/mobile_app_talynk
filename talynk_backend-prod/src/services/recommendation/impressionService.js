/**
 * Increments pending impression counters in Redis; flushed to DB by feedFlusher.
 */

const { getClient, redisReady } = require('../../lib/redis');

const IMP_PREFIX = 'feed:imp:';
const DIRTY_SET = 'feed:imp:dirty';

async function markDelivered(postIds) {
    if (!redisReady() || !postIds?.length) return;
    try {
        const redis = getClient();
        const pipe = redis.pipeline();
        for (const id of postIds) {
            if (!id) continue;
            pipe.incr(`${IMP_PREFIX}${id}`);
            pipe.sadd(DIRTY_SET, id);
        }
        await pipe.exec();
    } catch (e) {
        console.warn('[impressionService] markDelivered:', e.message);
    }
}

async function markEngagementDirty(postId) {
    if (!redisReady() || !postId) return;
    try {
        await getClient().sadd('feed:eng:dirty', postId);
    } catch (e) {
        console.warn('[impressionService] markEngagementDirty:', e.message);
    }
}

module.exports = {
    markDelivered,
    markEngagementDirty,
    IMP_PREFIX,
    IMP_DIRTY_SET: DIRTY_SET,
    ENG_DIRTY_SET: 'feed:eng:dirty'
};
