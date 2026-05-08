/**
 * Durable behavioral signals: UserPreference (categories) + UserCreatorAffinity (creators).
 * Call only on real engagement (like, comment, share) — not on feed impression.
 */

const prisma = require('../../lib/prisma');
const { markEngagementDirty } = require('./impressionService');

const WEIGHT = {
    like: 0.3,
    comment: 0.5,
    share: 0.7
};

const AFFINITY_INCREMENT = {
    like: 0.15,
    comment: 0.25,
    share: 0.35
};

async function bumpCategoryPreference(userId, categoryId, kind) {
    if (!categoryId) return;
    const inc = WEIGHT[kind] ?? 0.1;

    const existing = await prisma.userPreference.findUnique({
        where: {
            user_id_category_id: { user_id: userId, category_id: categoryId }
        }
    });

    if (existing) {
        await prisma.userPreference.update({
            where: {
                user_id_category_id: { user_id: userId, category_id: categoryId }
            },
            data: {
                preference_score: { increment: inc },
                interaction_count: { increment: 1 },
                last_interaction: new Date()
            }
        });
    } else {
        await prisma.userPreference.create({
            data: {
                user_id: userId,
                category_id: categoryId,
                preference_score: inc,
                interaction_count: 1,
                last_interaction: new Date()
            }
        });
    }
}

async function bumpCreatorAffinity(userId, creatorId, kind) {
    if (!creatorId || creatorId === userId) return;
    const inc = AFFINITY_INCREMENT[kind] ?? 0.1;

    const existing = await prisma.userCreatorAffinity.findFirst({
        where: {
            user_id: userId,
            creator_id: creatorId
        }
    });

    if (existing) {
        await prisma.userCreatorAffinity.update({
            where: {
                id: existing.id
            },
            data: {
                affinity_score: { increment: inc },
                interaction_count: { increment: 1 },
                last_interaction: new Date()
            }
        });
    } else {
        await prisma.userCreatorAffinity.create({
            data: {
                user_id: userId,
                creator_id: creatorId,
                affinity_score: inc,
                interaction_count: 1,
                last_interaction: new Date()
            }
        });
    }
}

/**
 * @param {'like'|'comment'|'share'} kind
 */
async function recordEngagement(userId, postId, kind) {
    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: { category_id: true, user_id: true }
    });
    if (!post) return;

    await bumpCategoryPreference(userId, post.category_id, kind);
    await bumpCreatorAffinity(userId, post.user_id, kind);
    await markEngagementDirty(postId);
}

module.exports = {
    recordEngagement,
    bumpCategoryPreference,
    bumpCreatorAffinity
};
