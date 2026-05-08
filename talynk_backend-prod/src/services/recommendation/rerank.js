/**
 * Diversity constraints + seeded shuffle within score ties (~5%).
 */

const { finalScore } = require('./scoring');

const TIE_RATIO = 0.05;

function mulberry32(a) {
    return function rand() {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeedStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function fisherYates(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function shuffleTieBands(sorted, seedStr) {
    if (sorted.length <= 1) return sorted;
    const rng = mulberry32(hashSeedStr(String(seedStr)));
    const out = [];
    let i = 0;
    while (i < sorted.length) {
        const refScore = sorted[i]._score || 0;
        let j = i + 1;
        while (j < sorted.length) {
            const s = sorted[j]._score || 0;
            const hi = Math.max(Math.abs(refScore), Math.abs(s), 1e-9);
            if (Math.abs(refScore - s) / hi <= TIE_RATIO) j++;
            else break;
        }
        const band = sorted.slice(i, j);
        out.push(...fisherYates(band, rng));
        i = j;
    }
    return out;
}

/**
 * Reduce streaks of same category (no 3 consecutive identical category_id).
 */
function reduceCategoryStreaks(order) {
    const out = [...order];
    const n = out.length;
    for (let i = 2; i < n; i++) {
        const c0 = out[i - 2]?.category_id;
        const c1 = out[i - 1]?.category_id;
        const c2 = out[i]?.category_id;
        if (c0 != null && c0 === c1 && c1 === c2) {
            let swapIdx = -1;
            for (let j = i + 1; j < Math.min(i + 12, n); j++) {
                if (out[j]?.category_id !== c2) {
                    swapIdx = j;
                    break;
                }
            }
            if (swapIdx === -1) {
                for (let j = i - 3; j >= 0; j--) {
                    if (out[j]?.category_id !== c2) {
                        swapIdx = j;
                        break;
                    }
                }
            }
            if (swapIdx >= 0) {
                const t = out[i];
                out[i] = out[swapIdx];
                out[swapIdx] = t;
            }
        }
    }
    return out;
}

function rerankPosts(posts, userCtx, shuffleSeed) {
    const scored = posts.map((p) => ({
        ...p,
        _score: finalScore(p, userCtx, {
            isExploration: !!p._explore
        })
    }));
    scored.sort((a, b) => (b._score || 0) - (a._score || 0));
    let ranked = shuffleTieBands(scored, shuffleSeed);
    ranked = reduceCategoryStreaks(ranked);
    return ranked;
}

/** Max `maxPerCreator` posts per creator in the first pass; fill remainder if needed. */
function takeWithCreatorCap(ordered, limit, maxPerCreator = 2) {
    const out = [];
    const counts = {};
    const seenIds = new Set();
    for (const p of ordered) {
        if (out.length >= limit) break;
        const uid = p.user_id || '';
        counts[uid] = counts[uid] || 0;
        if (counts[uid] >= maxPerCreator) continue;
        out.push(p);
        seenIds.add(p.id);
        counts[uid]++;
    }
    if (out.length < limit) {
        for (const p of ordered) {
            if (out.length >= limit) break;
            if (seenIds.has(p.id)) continue;
            out.push(p);
            seenIds.add(p.id);
        }
    }
    return out;
}

module.exports = {
    rerankPosts,
    shuffleTieBands,
    takeWithCreatorCap
};
