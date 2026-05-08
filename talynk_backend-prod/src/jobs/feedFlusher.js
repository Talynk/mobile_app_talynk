/**
 * Periodically drains Redis impression deltas into Post.impression_count and
 * recomputes Wilson engagement_score for dirty posts.
 */

const prisma = require('../lib/prisma');
const { getClient, redisReady } = require('../lib/redis');
const { wilsonLowerBound, positives } = require('../services/recommendation/scoring');

const IMP_PREFIX = 'feed:imp:';
const IMP_DIRTY = 'feed:imp:dirty';
const ENG_DIRTY = 'feed:eng:dirty';

/** Duplicate minimal logic if scoringHelpers not needed - use scoring.js positives */
async function flushImpressionsBatch() {
    if (!redisReady()) return;
    const redis = getClient();
    let ids = [];
    try {
        ids = await redis.smembers(IMP_DIRTY);
    } catch (e) {
        console.warn('[feedFlusher] smembers imp:', e.message);
        return;
    }
    if (!ids?.length) return;

    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        await Promise.all(
            chunk.map(async (postId) => {
                try {
                    const raw = await redis.get(`${IMP_PREFIX}${postId}`);
                    const delta = raw ? parseInt(raw, 10) : 0;
                    if (!delta || Number.isNaN(delta)) {
                        await redis.srem(IMP_DIRTY, postId);
                        await redis.del(`${IMP_PREFIX}${postId}`);
                        return;
                    }
                    await prisma.post.update({
                        where: { id: postId },
                        data: { impression_count: { increment: delta } }
                    });
                    await redis.del(`${IMP_PREFIX}${postId}`);
                    await redis.srem(IMP_DIRTY, postId);
                } catch (err) {
                    console.warn('[feedFlusher] impression flush', postId, err.message);
                }
            })
        );
    }
}

async function recomputeEngagementBatch() {
    if (!redisReady()) return;
    const redis = getClient();
    let ids = [];
    try {
        ids = await redis.smembers(ENG_DIRTY);
    } catch (e) {
        console.warn('[feedFlusher] smembers eng:', e.message);
        return;
    }
    if (!ids?.length) return;

    const chunkSize = 30;
    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const rows = await prisma.post.findMany({
            where: { id: { in: chunk } },
            select: {
                id: true,
                likes: true,
                comment_count: true,
                shares: true,
                impression_count: true
            }
        });
        for (const row of rows) {
            try {
                const pos = positives(row);
                const total = Math.max(row.impression_count ?? 0, pos, 1);
                const score = wilsonLowerBound(pos, total);
                await prisma.post.update({
                    where: { id: row.id },
                    data: {
                        engagement_score: score,
                        last_engagement_at: new Date()
                    }
                });
                await redis.srem(ENG_DIRTY, row.id);
            } catch (err) {
                console.warn('[feedFlusher] engagement', row.id, err.message);
            }
        }
        for (const id of chunk) {
            const found = rows.find((r) => r.id === id);
            if (!found) await redis.srem(ENG_DIRTY, id);
        }
    }
}

let timer = null;

function startFeedFlusher() {
    if (process.env.FEED_FLUSHER === 'false') return;
    const intervalMs = parseInt(process.env.FEED_FLUSH_INTERVAL_MS || '60000', 10) || 60000;

    const tick = async () => {
        try {
            await flushImpressionsBatch();
            await recomputeEngagementBatch();
        } catch (e) {
            console.error('[feedFlusher] tick', e);
        }
    };

    timer = setInterval(tick, intervalMs);
    timer.unref?.();
    tick();
}

module.exports = {
    startFeedFlusher,
    flushImpressionsBatch,
    recomputeEngagementBatch
};
