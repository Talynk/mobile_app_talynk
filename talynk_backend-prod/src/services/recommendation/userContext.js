/**
 * Loads category + creator affinity context for scoring / candidate pools.
 */

const prisma = require('../../lib/prisma');
const { softmaxProbabilities } = require('./scoring');

async function loadUserContext(userId) {
    if (!userId) return null;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            interests: true,
            preferences: {
                orderBy: { preference_score: 'desc' },
                take: 20,
                select: {
                    category_id: true,
                    preference_score: true
                }
            },
            creatorAffinitiesMade: {
                orderBy: { affinity_score: 'desc' },
                take: 20,
                select: {
                    creator_id: true,
                    affinity_score: true
                }
            }
        }
    });

    if (!user) return null;

    const catScores = {};
    for (const p of user.preferences) {
        const v = Math.max(0.001, p.preference_score ?? 0);
        catScores[p.category_id] = v;
    }

    const creScores = {};
    for (const a of user.creatorAffinitiesMade) {
        const v = Math.max(0.001, a.affinity_score ?? 0);
        creScores[a.creator_id] = v;
    }

    const categoryProbs = softmaxProbabilities(catScores);
    const creatorProbs = softmaxProbabilities(creScores);

    const topCategoryIds = Object.entries(categoryProbs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => parseInt(id, 10));

    const topCreatorIds = Object.entries(creatorProbs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id]) => id);

    return {
        userId: user.id,
        interests: user.interests || [],
        categoryProbs,
        creatorProbs,
        topCategoryIds,
        topCreatorIds
    };
}

module.exports = {
    loadUserContext
};
