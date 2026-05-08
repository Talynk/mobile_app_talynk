const prisma = require('../lib/prisma');
const { runPersonalizedFeed } = require('../services/recommendation/feedPipeline');
const affinityService = require('../services/recommendation/affinityService');

// Get personalized feed for user — unified TikTok-style pipeline (same as GET /feed/personalized)
exports.getPersonalizedFeed = async (req, res) => {
    try {
        const userId = req.user.id;
        const limit = parseInt(req.query.limit ?? '10', 10) || 10;

        const data = await runPersonalizedFeed(req);

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                preferences: {
                    include: {
                        category: true
                    },
                    orderBy: {
                        preference_score: 'desc'
                    }
                }
            }
        });

        res.json({
            status: 'success',
            data: {
                ...data,
                userPreferences: (user?.preferences || []).map((p) => ({
                    category: p.category.name,
                    score: p.preference_score
                }))
            },
            pagination: {
                currentPage: parseInt(req.query.page ?? '1', 10) || 1,
                totalPages: null,
                totalCount: null,
                hasNext: (data.posts?.length || 0) >= limit,
                hasPrev: false
            }
        });
    } catch (error) {
        console.error('Get personalized feed error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching personalized feed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get trending posts
exports.getTrendingPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10, timeframe = '7' } = req.query;
        const offset = (page - 1) * limit;
        const daysAgo = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);

        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: {
                    status: 'active',
                    is_frozen: false,
                    createdAt: {
                        gte: daysAgo
                    }
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            profile_picture: true
                        }
                    },
                    category: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    _count: {
                        select: {
                            comments: true,
                            postLikes: true
                        }
                    }
                },
                orderBy: [
                    { is_featured: 'desc' },
                    { likes: 'desc' },
                    { views: 'desc' },
                    { comment_count: 'desc' }
                ],
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: {
                    status: 'active',
                    is_frozen: false,
                    createdAt: {
                        gte: daysAgo
                    }
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                posts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                },
                timeframe: `${timeframe} days`
            }
        });
    } catch (error) {
        console.error('Get trending posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching trending posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get recommended categories for user
exports.getRecommendedCategories = async (req, res) => {
    try {
        const userId = req.user.id;

        const userPreferences = await prisma.userPreference.findMany({
            where: { user_id: userId },
            include: {
                category: true
            },
            orderBy: {
                preference_score: 'desc'
            }
        });

        const allCategories = await prisma.category.findMany({
            where: { status: 'active' },
            include: {
                _count: {
                    select: {
                        posts: {
                            where: {
                                status: 'active',
                                is_frozen: false
                            }
                        }
                    }
                }
            },
            orderBy: {
                posts: {
                    _count: 'desc'
                }
            }
        });

        const userCategoryIds = userPreferences.map((p) => p.category_id);
        const recommendedCategories = allCategories
            .filter((cat) => !userCategoryIds.includes(cat.id))
            .slice(0, 10);

        res.json({
            status: 'success',
            data: {
                currentPreferences: userPreferences.map((p) => ({
                    category: p.category,
                    score: p.preference_score,
                    interactionCount: p.interaction_count
                })),
                recommendedCategories: recommendedCategories.map((cat) => ({
                    id: cat.id,
                    name: cat.name,
                    description: cat.description,
                    postCount: cat._count.posts
                }))
            }
        });
    } catch (error) {
        console.error('Get recommended categories error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching recommended categories',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Record explicit interaction — preferences updated only for real engagement types
exports.recordInteraction = async (req, res) => {
    try {
        const { postId } = req.params;
        const { interactionType } = req.body;
        const userId = req.user.id;

        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: { category_id: true }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        const map = {
            like: 'like',
            comment: 'comment',
            share: 'share'
        };
        const kind = map[interactionType];

        if (kind) {
            await affinityService.recordEngagement(userId, postId, kind);
        }

        res.json({
            status: 'success',
            message: 'Interaction recorded successfully'
        });
    } catch (error) {
        console.error('Record interaction error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error recording interaction',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
