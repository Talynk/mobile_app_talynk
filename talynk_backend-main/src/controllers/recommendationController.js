const prisma = require('../lib/prisma');

// Get personalized feed for user
exports.getPersonalizedFeed = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        // Get user preferences and interests
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                interests: true,
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

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Build recommendation query
        let whereClause = {
            status: 'active',
            is_frozen: false
        };

        // If user has preferences, prioritize those categories
        if (user.preferences.length > 0) {
            const preferredCategoryIds = user.preferences.map(p => p.category_id);
            whereClause.category_id = {
                in: preferredCategoryIds
            };
        } else if (user.interests && user.interests.length > 0) {
            // Fallback to interests if no preferences
            const categories = await prisma.category.findMany({
                where: {
                    name: {
                        in: user.interests
                    }
                },
                select: { id: true }
            });
            
            if (categories.length > 0) {
                whereClause.category_id = {
                    in: categories.map(c => c.id)
                };
            }
        }

        // Get personalized posts
        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: whereClause,
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
                    { createdAt: 'desc' }
                ],
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: whereClause
            })
        ]);

        // Update user preferences based on interaction
        await updateUserPreferences(userId, posts);

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
                userPreferences: user.preferences.map(p => ({
                    category: p.category.name,
                    score: p.preference_score
                }))
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

        // Get user's current preferences
        const userPreferences = await prisma.userPreference.findMany({
            where: { user_id: userId },
            include: {
                category: true
            },
            orderBy: {
                preference_score: 'desc'
            }
        });

        // Get all categories with post counts
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

        // Filter out categories user already has preferences for
        const userCategoryIds = userPreferences.map(p => p.category_id);
        const recommendedCategories = allCategories
            .filter(cat => !userCategoryIds.includes(cat.id))
            .slice(0, 10);

        res.json({
            status: 'success',
            data: {
                currentPreferences: userPreferences.map(p => ({
                    category: p.category,
                    score: p.preference_score,
                    interactionCount: p.interaction_count
                })),
                recommendedCategories: recommendedCategories.map(cat => ({
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

// Update user preferences based on interaction
async function updateUserPreferences(userId, posts) {
    try {
        for (const post of posts) {
            if (post.category_id) {
                const existingPreference = await prisma.userPreference.findUnique({
                    where: {
                        user_id_category_id: {
                            user_id: userId,
                            category_id: post.category_id
                        }
                    }
                });

                if (existingPreference) {
                    // Update existing preference
                    await prisma.userPreference.update({
                        where: {
                            user_id_category_id: {
                                user_id: userId,
                                category_id: post.category_id
                            }
                        },
                        data: {
                            preference_score: {
                                increment: 0.1
                            },
                            interaction_count: {
                                increment: 1
                            },
                            last_interaction: new Date()
                        }
                    });
                } else {
                    // Create new preference
                    await prisma.userPreference.create({
                        data: {
                            user_id: userId,
                            category_id: post.category_id,
                            preference_score: 0.1,
                            interaction_count: 1,
                            last_interaction: new Date()
                        }
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error updating user preferences:', error);
    }
}

// Record user interaction with post
exports.recordInteraction = async (req, res) => {
    try {
        const { postId } = req.params;
        const { interactionType } = req.body; // 'view', 'like', 'comment', 'share'
        const userId = req.user.id;

        // Get post to find category
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

        if (post.category_id) {
            const existingPreference = await prisma.userPreference.findUnique({
                where: {
                    user_id_category_id: {
                        user_id: userId,
                        category_id: post.category_id
                    }
                }
            });

            const scoreIncrement = getScoreIncrement(interactionType);

            if (existingPreference) {
                await prisma.userPreference.update({
                    where: {
                        user_id_category_id: {
                            user_id: userId,
                            category_id: post.category_id
                        }
                    },
                    data: {
                        preference_score: {
                            increment: scoreIncrement
                        },
                        interaction_count: {
                            increment: 1
                        },
                        last_interaction: new Date()
                    }
                });
            } else {
                await prisma.userPreference.create({
                    data: {
                        user_id: userId,
                        category_id: post.category_id,
                        preference_score: scoreIncrement,
                        interaction_count: 1,
                        last_interaction: new Date()
                    }
                });
            }
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

// Helper function to get score increment based on interaction type
function getScoreIncrement(interactionType) {
    switch (interactionType) {
        case 'view': return 0.1;
        case 'like': return 0.3;
        case 'comment': return 0.5;
        case 'share': return 0.7;
        default: return 0.1;
    }
}

