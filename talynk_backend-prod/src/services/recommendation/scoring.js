/**
 * Lightweight heuristic scoring for feed ranking (Wilson-bound engagement,
 * freshness, fairness, tier amplification). Tunable via env.
 */

const FEED_W_IQ = Number(process.env.FEED_W_IQ) || 0.35;
const FEED_W_BR = Number(process.env.FEED_W_BR) || 0.25;
const FEED_W_FRESH = Number(process.env.FEED_W_FRESH) || 0.15;
const FEED_W_FAIR = Number(process.env.FEED_W_FAIR) || 0.15;
const FEED_W_EXPLORE = Number(process.env.FEED_W_EXPLORE) || 0.1;
const FEED_LAMBDA_DECAY = Number(process.env.FEED_LAMBDA_DECAY) || 0.05;
const FEED_MIN_IMPRESSIONS = parseInt(process.env.FEED_MIN_IMPRESSIONS || '200', 10);
const FEED_HOT_THRESHOLD = parseInt(process.env.FEED_HOT_THRESHOLD || '2000', 10);

function wilsonLowerBound(positive, total, z = 1.96) {
    if (total <= 0) return 0;
    const phat = Math.min(1, Math.max(0, positive / total));
    const denom = 1 + (z * z) / total;
    const center = phat + (z * z) / (2 * total);
    const margin =
        z *
        Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
    return (center - margin) / denom;
}

function positives(post) {
    const likes = post.likes ?? 0;
    const comments = post.comment_count ?? 0;
    const shares = post.shares ?? 0;
    return likes + 2 * comments + 3 * shares;
}

/** Wilson score stored in Post.engagement_score (also recomputed in flusher). */
function engagementWilson(post) {
    const pos = positives(post);
    const imp = post.impression_count ?? 0;
    const total = Math.max(imp, pos, 1);
    return wilsonLowerBound(pos, total);
}

function freshness(post, lambda = FEED_LAMBDA_DECAY) {
    const created = post.createdAt ? new Date(post.createdAt).getTime() : Date.now();
    const hours = (Date.now() - created) / (1000 * 60 * 60);
    return Math.exp(-lambda * hours);
}

function fairness(post) {
    const imp = post.impression_count ?? 0;
    return 1 / (1 + Math.log(1 + imp));
}

function tierMultiplier(post) {
    const imp = post.impression_count ?? 0;
    const w = post.engagement_score ?? 0;
    if (imp < FEED_MIN_IMPRESSIONS) return 1.5;
    if (imp < FEED_HOT_THRESHOLD) return 1.0 + 0.5 * w;
    return 0.7 + 1.0 * w;
}

/** Softmax over scores map -> id -> probability */
function softmaxProbabilities(scoresMap, temperature = 1) {
    const entries = Object.entries(scoresMap).filter(([, v]) => v > 0);
    if (entries.length === 0) return {};
    const maxLog = Math.max(...entries.map(([, v]) => Math.log(v + 1e-9)));
    let sum = 0;
    const exp = {};
    for (const [id, v] of entries) {
        exp[id] = Math.exp((Math.log(v + 1e-9) - maxLog) / temperature);
        sum += exp[id];
    }
    const out = {};
    for (const id of Object.keys(exp)) {
        out[id] = exp[id] / sum;
    }
    return out;
}

function behavioralRelevance(post, userCtx) {
    if (!userCtx) return 0;
    const catId = post.category_id;
    const creatorId = post.user_id;
    let catP = 0;
    let creP = 0;
    if (catId != null && userCtx.categoryProbs && userCtx.categoryProbs[catId] != null) {
        catP = userCtx.categoryProbs[catId];
    }
    if (creatorId && userCtx.creatorProbs && userCtx.creatorProbs[creatorId] != null) {
        creP = userCtx.creatorProbs[creatorId];
    }
    return 0.6 * catP + 0.4 * creP;
}

function defaultWeights() {
    return {
        iq: FEED_W_IQ,
        br: FEED_W_BR,
        fresh: FEED_W_FRESH,
        fair: FEED_W_FAIR,
        explore: FEED_W_EXPLORE
    };
}

/**
 * @param {object} post - Prisma post row with counters + impression_count + engagement_score
 * @param {object|null} userCtx - from loadUserContext
 * @param {{ isExploration?: boolean }} opts
 */
function finalScore(post, userCtx, opts = {}) {
    const w = defaultWeights();
    const iq = post.engagement_score ?? engagementWilson(post);
    const br = behavioralRelevance(post, userCtx);
    const fr = freshness(post);
    const fa = fairness(post);
    const ex = opts.isExploration ? 1 : 0;

    const inner =
        w.iq * iq +
        w.br * br +
        w.fresh * fr +
        w.fair * fa +
        w.explore * ex;

    return tierMultiplier({ ...post, engagement_score: iq }) * inner;
}

module.exports = {
    wilsonLowerBound,
    positives,
    engagementWilson,
    freshness,
    fairness,
    tierMultiplier,
    softmaxProbabilities,
    behavioralRelevance,
    finalScore,
    defaultWeights,
    FEED_MIN_IMPRESSIONS,
    FEED_HOT_THRESHOLD
};
