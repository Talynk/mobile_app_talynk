/**
 * Five-way candidate pools for personalized / guest feeds.
 */

const prisma = require('../../lib/prisma');
const { applyFeedReadyFilter } = require('../../utils/postFilters');
const { positives } = require('./scoring');
const { FEED_MIN_IMPRESSIONS } = require('./scoring');

const HOURS_72 = 72 * 60 * 60 * 1000;
const DAYS_14 = 14 * 24 * 60 * 60 * 1000;
const DAYS_7 = 7 * 24 * 60 * 60 * 1000;

const POST_POOL_SELECT = {
    id: true,
    user_id: true,
    title: true,
    description: true,
    content: true,
    video_url: true,
    hls_url: true,
    thumbnail_url: true,
    processing_status: true,
    type: true,
    likes: true,
    comment_count: true,
    views: true,
    shares: true,
    is_featured: true,
    createdAt: true,
    category_id: true,
    impression_count: true,
    engagement_score: true,
    category: { select: { id: true, name: true } },
    user: {
        select: {
            id: true,
            username: true,
            profile_picture: true,
            country: { select: { id: true, name: true, code: true, flag_emoji: true } }
        }
    }
};

function mergeExcludeSeen(where, seenIds) {
    if (!seenIds?.size) return where;
    return {
        ...where,
        id: { notIn: [...seenIds] }
    };
}

function dedupeById(posts) {
    const map = new Map();
    for (const p of posts) {
        if (p?.id && !map.has(p.id)) map.set(p.id, p);
    }
    return [...map.values()];
}

function sortByPositivesDesc(rows) {
    return [...rows].sort((a, b) => positives(b) - positives(a));
}

async function poolBehavioral(userCtx, seenIds, take) {
    const base = applyFeedReadyFilter({
        status: 'active',
        is_frozen: false,
        is_ad: false,
        createdAt: { gte: new Date(Date.now() - DAYS_14) }
    });
    const past = new Date(Date.now() - DAYS_14);

    const orConds = [];
    if (userCtx?.topCategoryIds?.length) {
        orConds.push({ category_id: { in: userCtx.topCategoryIds } });
    }
    if (userCtx?.topCreatorIds?.length) {
        orConds.push({ user_id: { in: userCtx.topCreatorIds } });
    }
    if (!orConds.length) return [];

    const where = mergeExcludeSeen(
        {
            ...base,
            createdAt: { gte: past },
            OR: orConds
        },
        seenIds
    );

    const rows = await prisma.post.findMany({
        where,
        select: POST_POOL_SELECT,
        orderBy: [{ engagement_score: 'desc' }, { createdAt: 'desc' }],
        take: take * 2
    });
    return rows.slice(0, take);
}

async function poolTrending(windowMs, seenIds, take, extraWhere = {}) {
    const since = new Date(Date.now() - windowMs);
    const base = applyFeedReadyFilter({
        status: 'active',
        is_frozen: false,
        is_ad: false,
        createdAt: { gte: since },
        ...extraWhere
    });
    const where = mergeExcludeSeen(base, seenIds);
    const rows = await prisma.post.findMany({
        where,
        select: POST_POOL_SELECT,
        take: Math.min(400, take * 40)
    });
    return sortByPositivesDesc(rows).slice(0, take);
}

async function poolFollowing(userId, seenIds, take) {
    const follows = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
        take: 500
    });
    const ids = follows.map((f) => f.followingId);
    if (!ids.length) return [];

    const since = new Date(Date.now() - DAYS_7);
    const base = applyFeedReadyFilter({
        status: 'active',
        is_frozen: false,
        is_ad: false,
        user_id: { in: ids },
        createdAt: { gte: since }
    });
    const where = mergeExcludeSeen(base, seenIds);

    return prisma.post.findMany({
        where,
        select: POST_POOL_SELECT,
        orderBy: { createdAt: 'desc' },
        take
    });
}

async function poolFairness(seenIds, take) {
    const base = applyFeedReadyFilter({
        status: 'active',
        is_frozen: false,
        is_ad: false,
        impression_count: { lt: FEED_MIN_IMPRESSIONS }
    });
    const where = mergeExcludeSeen(base, seenIds);
    const rows = await prisma.post.findMany({
        where,
        select: POST_POOL_SELECT,
        take: Math.min(500, take * 25),
        orderBy: { createdAt: 'desc' }
    });
    // random-ish sample
    const shuffled = [...rows].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, take);
}

async function poolExploration(userCtx, seenIds, take, refreshSeed) {
    const base = applyFeedReadyFilter({
        status: 'active',
        is_frozen: false,
        is_ad: false
    });
    let where = mergeExcludeSeen(base, seenIds);

    const excludeCats = userCtx?.topCategoryIds || [];
    if (excludeCats.length) {
        where = {
            ...where,
            OR: [{ category_id: null }, { category_id: { notIn: excludeCats } }]
        };
    }

    const rows = await prisma.post.findMany({
        where,
        select: POST_POOL_SELECT,
        take: Math.min(300, take * 30),
        orderBy: { createdAt: 'desc' }
    });
    const seedStr = String(refreshSeed);
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) h = (Math.imul(31, h) + seedStr.charCodeAt(i)) | 0;
    const rng = mulberry32(h >>> 0);
    const shuffled = fisherYates([...rows], rng);
    return shuffled.slice(0, take).map((p) => ({
        ...p,
        _explore: true
    }));
}

function mulberry32(a) {
    return function rand() {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function fisherYates(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * @param {{ userId?: string, userCtx?: object|null, guest?: boolean, countryId?: number|null, refreshSeed: string|number, limit: number, seenIds: Set<string> }}
 */
async function buildCandidates(opts) {
    const {
        userId,
        userCtx,
        guest,
        countryId,
        refreshSeed,
        limit,
        seenIds
    } = opts;

    const budget = Math.max(limit * 6, 60);
    let parts = [];

    if (guest) {
        const tLocal = Math.ceil(budget * 0.5);
        const tGlobal = Math.ceil(budget * 0.25);
        const fairN = Math.ceil(budget * 0.15);
        const exploreN = Math.ceil(budget * 0.1);

        const localExtra =
            countryId != null
                ? { user: { country_id: countryId } }
                : {};

        const [trendLocal, trendGlobal, fair, explore] = await Promise.all([
            poolTrending(HOURS_72, seenIds, tLocal, localExtra),
            poolTrending(HOURS_72, seenIds, tGlobal, {}),
            poolFairness(seenIds, fairN),
            poolExploration(null, seenIds, exploreN, refreshSeed)
        ]);
        parts = [...trendLocal, ...trendGlobal, ...fair, ...explore];
    } else {
        const b = Math.ceil(budget * 0.4);
        const t = Math.ceil(budget * 0.2);
        const f = Math.ceil(budget * 0.15);
        const fairN = Math.ceil(budget * 0.15);
        const e = Math.ceil(budget * 0.1);

        const [beh, trend, follow, fair, explore] = await Promise.all([
            poolBehavioral(userCtx, seenIds, b),
            poolTrending(HOURS_72, seenIds, t),
            poolFollowing(userId, seenIds, f),
            poolFairness(seenIds, fairN),
            poolExploration(userCtx, seenIds, e, refreshSeed)
        ]);
        parts = [...beh, ...trend, ...follow, ...fair, ...explore];
    }

    return dedupeById(parts);
}

async function resolveCountryIdFromRequestCode(requestCountryCode) {
    if (!requestCountryCode) return null;
    const code = requestCountryCode.toUpperCase();
    const row = await prisma.country.findFirst({
        where: { code },
        select: { id: true }
    });
    return row?.id ?? null;
}

module.exports = {
    buildCandidates,
    resolveCountryIdFromRequestCode,
    POST_POOL_SELECT
};
