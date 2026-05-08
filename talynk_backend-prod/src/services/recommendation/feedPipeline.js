/**
 * TikTok-style lightweight feed pipeline (candidate pools + rerank + impressions).
 */

const prisma = require('../../lib/prisma');
const { applyFeedReadyFilter } = require('../../utils/postFilters');
const { withVideoPlaybackUrl } = require('../../utils/postVideoUtils');
const { loadUserContext } = require('./userContext');
const { buildCandidates, resolveCountryIdFromRequestCode } = require('./candidatePool');
const { rerankPosts, takeWithCreatorCap } = require('./rerank');
const { markDelivered } = require('./impressionService');
const {
    keyUser,
    keyGuest,
    getSeenIds,
    addSeen,
    clearSeen
} = require('./seenSet');
const { interleavePostsWithAds } = require('./adInjector');

const MAX_FEED_LIMIT = 20;
const DEFAULT_FEED_LIMIT = 10;

function parseLimit(query) {
    return Math.min(
        Math.max(parseInt(query.limit, 10) || DEFAULT_FEED_LIMIT, 1),
        MAX_FEED_LIMIT
    );
}

function parseRefreshEpoch(query) {
    const raw = query.refresh;
    if (raw !== undefined && raw !== '') {
        const n = parseInt(String(raw), 10);
        if (!Number.isNaN(n)) return n;
    }
    return Math.floor(Date.now() / 60000);
}

function getRequestCountryCode(req) {
    const geoCode = req.geo?.country_code;
    if (geoCode && typeof geoCode === 'string') return geoCode.toUpperCase();
    const cfCode = req.headers?.['cf-ipcountry'];
    if (cfCode && typeof cfCode === 'string') return cfCode.toUpperCase();
    return null;
}

function getDeviceFingerprint(req) {
    const fp = req.headers['x-device-fingerprint'];
    if (fp && typeof fp === 'string' && fp.length > 2) return fp;
    return null;
}

async function fetchAds(take = 80) {
    return prisma.post.findMany({
        where: applyFeedReadyFilter({
            is_ad: true,
            status: 'active'
        }),
        orderBy: { createdAt: 'desc' },
        take,
        select: {
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
            is_ad: true,
            category: { select: { id: true, name: true } },
            user: {
                select: {
                    id: true,
                    username: true,
                    profile_picture: true,
                    country: {
                        select: { id: true, name: true, code: true, flag_emoji: true }
                    }
                }
            }
        }
    });
}

function toPublicDTO(post) {
    const p = withVideoPlaybackUrl(post);
    return {
        id: p.id,
        user_id: p.user_id,
        user: p.user || null,
        title: p.title || null,
        caption: p.description || p.content || null,
        playback_url: p.fullUrl || null,
        stream_type: p.streamType || null,
        thumbnail_url: p.thumbnail_url || null,
        like_count: p.likes ?? 0,
        comment_count: p.comment_count ?? 0,
        view_count: p.views ?? 0,
        is_featured: p.is_featured || false,
        created_at: p.createdAt,
        is_ad: !!p.is_ad
    };
}

function toPersonalizedDTO(post) {
    const base = toPublicDTO(post);
    base.is_liked = Array.isArray(post.postLikes) && post.postLikes.length > 0;
    base.is_following_author = !!(
        post.user &&
        Array.isArray(post.user.followers) &&
        post.user.followers.length > 0
    );
    return base;
}

async function attachPersonalization(posts, userId) {
    if (!posts.length) return [];
    const ids = posts.map((p) => p.id);
    const authorIds = [...new Set(posts.map((p) => p.user_id).filter(Boolean))];

    const [likesRows, followRows] = await Promise.all([
        prisma.postLike.findMany({
            where: { user_id: userId, post_id: { in: ids } },
            select: { post_id: true }
        }),
        authorIds.length
            ? prisma.follow.findMany({
                  where: { followerId: userId, followingId: { in: authorIds } },
                  select: { followingId: true }
              })
            : Promise.resolve([])
    ]);

    const likeSet = new Set(likesRows.map((r) => r.post_id));
    const followSet = new Set(followRows.map((r) => r.followingId));

    return posts.map((p) => ({
        ...p,
        postLikes: likeSet.has(p.id) ? [{ id: 'virtual' }] : [],
        user: p.user
            ? {
                  ...p.user,
                  followers: followSet.has(p.user_id) ? [{ id: 'virtual' }] : []
              }
            : p.user
    }));
}

function stripMeta(p) {
    const { _score, _explore, ...rest } = p;
    return rest;
}

async function runPublicFeed(req) {
    const limit = parseLimit(req.query);
    const refreshEpoch = parseRefreshEpoch(req.query);
    const requestCountryCode = getRequestCountryCode(req);
    const fp = getDeviceFingerprint(req);
    const guestKey = fp ? keyGuest(fp) : keyGuest('anon');
    const shuffleSeed = `${guestKey}:${refreshEpoch}`;

    const countryId = await resolveCountryIdFromRequestCode(requestCountryCode);
    const seenIds = await getSeenIds(guestKey);

    const candidates = await buildCandidates({
        guest: true,
        countryId,
        refreshSeed: refreshEpoch,
        limit,
        seenIds
    });

    const userCtx = null;
    const ranked = rerankPosts(candidates, userCtx, shuffleSeed);
    const page = takeWithCreatorCap(ranked, limit).map(stripMeta);

    await markDelivered(page.map((p) => p.id));
    await addSeen(
        guestKey,
        page.map((p) => p.id)
    );

    const ads = await fetchAds();
    const interleaved = interleavePostsWithAds(page, ads);
    const dto = interleaved.map((entry) => {
        const raw = entry.item;
        if (entry.kind === 'ad') {
            return toPublicDTO({ ...raw, is_ad: true });
        }
        return toPublicDTO(raw);
    });

    return {
        posts: dto,
        nextCursor: null,
        refresh: refreshEpoch,
        country_personalization: requestCountryCode || null,
        feed_meta: { pipeline: 'tiktok-lite', guest: true }
    };
}

async function runPersonalizedFeed(req) {
    const userId = req.user.id;
    const limit = parseLimit(req.query);
    const refreshEpoch = parseRefreshEpoch(req.query);
    const shuffleSeed = `${userId}:${refreshEpoch}`;

    const userCtx = await loadUserContext(userId);
    const seenKey = keyUser(userId);
    const seenIds = await getSeenIds(seenKey);

    const candidates = await buildCandidates({
        userId,
        userCtx,
        guest: false,
        refreshSeed: refreshEpoch,
        limit,
        seenIds
    });

    const ranked = rerankPosts(candidates, userCtx, shuffleSeed);
    const capped = takeWithCreatorCap(ranked, limit).map(stripMeta);

    const enriched = await attachPersonalization(capped, userId);

    await markDelivered(enriched.map((p) => p.id));
    await addSeen(
        seenKey,
        enriched.map((p) => p.id)
    );

    const ads = await fetchAds();
    const interleaved = interleavePostsWithAds(enriched, ads);
    const dto = interleaved.map((entry) => {
        const raw = entry.item;
        if (entry.kind === 'ad') {
            return toPersonalizedDTO({ ...raw, is_ad: true, postLikes: [], user: raw.user });
        }
        return toPersonalizedDTO(raw);
    });

    return {
        posts: dto,
        nextCursor: null,
        refresh: refreshEpoch,
        feed_meta: { pipeline: 'tiktok-lite' }
    };
}

module.exports = {
    runPublicFeed,
    runPersonalizedFeed,
    parseLimit,
    parseRefreshEpoch,
    getRequestCountryCode,
    clearSeen,
    keyUser,
    keyGuest
};
