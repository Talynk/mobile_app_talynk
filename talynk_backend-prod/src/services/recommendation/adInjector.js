/**
 * Shared ad interleave pattern (5 posts, 1 ad, 8 posts, 1 ad, …).
 */

const AD_INTERLEAVE_PATTERN = [5, 8];

/**
 * For a segment [offset, offset+limit) in the interleaved stream (content + ads in 5-8-5-8 pattern),
 * returns how many content items and ads to fetch and their skip counts.
 */
function getInterleaveCounts(offset, limit) {
    let pos = 0;
    let contentIdx = 0;
    let adIdx = 0;
    let p = 0;
    while (pos < offset) {
        for (let i = 0; i < AD_INTERLEAVE_PATTERN[p]; i++) {
            if (pos >= offset) break;
            contentIdx++;
            pos++;
        }
        if (pos < offset) {
            adIdx++;
            pos++;
        }
        p = 1 - p;
    }
    const contentSkip = contentIdx;
    const adSkip = adIdx;
    let count = 0;
    while (count < limit) {
        for (let i = 0; i < AD_INTERLEAVE_PATTERN[p]; i++) {
            if (count >= limit) break;
            contentIdx++;
            count++;
        }
        if (count < limit) {
            adIdx++;
            count++;
        }
        p = 1 - p;
    }
    return {
        contentSkip,
        contentTake: contentIdx - contentSkip,
        adSkip,
        adTake: adIdx - adSkip
    };
}

/** Total items (content + ads) for contentCount content pieces in the interleaved stream */
function totalInterleavedSize(contentCount) {
    let contentLeft = contentCount;
    let items = 0;
    let p = 0;
    while (contentLeft > 0) {
        const take = Math.min(AD_INTERLEAVE_PATTERN[p], contentLeft);
        items += take;
        contentLeft -= take;
        if (take === AD_INTERLEAVE_PATTERN[p]) items += 1;
        p = 1 - p;
    }
    return items;
}

/**
 * @param {Array<{kind:'post'|'ad', item: object}>} items — builder fills these
 */
function interleavePostsWithAds(contentPosts, adsList) {
    const pattern = AD_INTERLEAVE_PATTERN;
    let p = 0;
    let ci = 0;
    let ai = 0;
    const out = [];

    while (ci < contentPosts.length) {
        for (let i = 0; i < pattern[p] && ci < contentPosts.length; i++) {
            out.push({ kind: 'post', item: contentPosts[ci++] });
        }
        if (adsList.length > 0) {
            const ad = adsList[ai % adsList.length];
            ai++;
            out.push({ kind: 'ad', item: ad });
        }
        p = 1 - p;
        if (!adsList.length) {
            while (ci < contentPosts.length) {
                out.push({ kind: 'post', item: contentPosts[ci++] });
            }
            break;
        }
    }
    return out;
}

module.exports = {
    AD_INTERLEAVE_PATTERN,
    getInterleaveCounts,
    totalInterleavedSize,
    interleavePostsWithAds
};
