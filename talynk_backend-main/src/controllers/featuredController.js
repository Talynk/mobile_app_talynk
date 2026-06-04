const prisma = require('../lib/prisma');
const { 
    CACHE_KEYS, 
    getFeaturedPostsCache, 
    setFeaturedPostsCache,
    clearCacheByPattern 
} = require('../utils/cache');
const { emitEvent } = require('../lib/realtime');
const { withVideoPlaybackUrl } = require('../utils/postVideoUtils');
const { applyFeedReadyFilter } = require('../utils/postFilters');

// Get featured posts with optimized queries and caching
exports.getFeaturedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10, sort = 'newest' } = req.query;
        const offset = (page - 1) * limit;
        const currentDate = new Date();

        // Create cache key
        const cacheKey = `${CACHE_KEYS.FEATURED_POSTS}_${sort}_${page}_${limit}`;
        
        // Try to get from cache first
        const cachedData = await getFeaturedPostsCache(cacheKey);
        if (cachedData) {
            console.log('Serving featured posts from cache');
            return res.json({
                status: 'success',
                data: cachedData,
                cached: true
            });
        }

        // Build optimized where clause (only feed-ready posts)
        const whereClause = {
            is_active: true,
            OR: [
                { expires_at: null },
                { expires_at: { gt: currentDate } }
            ],
            post: applyFeedReadyFilter({})
        };

        // Determine sort order
        const orderBy = sort === 'oldest' 
            ? { createdAt: 'asc' } 
            : { createdAt: 'desc' };

        const [featuredPosts, totalCount] = await Promise.all([
            prisma.featuredPost.findMany({
                where: whereClause,
                include: {
                    post: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true,
                                    profile_picture: true,
                                    country: {
                                        select: {
                                            id: true,
                                            name: true,
                                            code: true,
                                            flag_emoji: true
                                        }
                                    }
                                }
                            },
                            category: {
                                select: {
                                    id: true,
                                    name: true,
                                    description: true
                                }
                            },
                            _count: {
                                select: {
                                    comments: true,
                                    postLikes: true,
                                    postViews: true
                                }
                            }
                        }
                    },
                    admin: {
                        select: {
                            id: true,
                            username: true
                        }
                    }
                },
                orderBy,
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.featuredPost.count({
                where: whereClause
            })
        ]);

        // Process posts: add full URLs for playback (HLS when ready, else raw)
        const processedPosts = featuredPosts.map(featured => {
            const post = featured.post;
            const p = withVideoPlaybackUrl(post);
            p.isFeatured = true;
            p.featuredAt = featured.createdAt;
            p.expiresAt = featured.expires_at;
            p.featuredBy = featured.admin?.username;
            p.featuredReason = featured.reason;
            return { id: featured.id, post: p };
        });

        const responseData = {
            featuredPosts: processedPosts,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount,
                hasNext: page * limit < totalCount,
                hasPrev: page > 1,
                limit: parseInt(limit)
            },
            filters: {
                sort,
                activeOnly: true
            }
        };

        // Cache the response
        await setFeaturedPostsCache(cacheKey, responseData);

        res.json({
            status: 'success',
            data: responseData,
            cached: false
        });

    } catch (error) {
        console.error('Get featured posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching featured posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Feature a post (Admin only)
exports.featurePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const { reason, expiresAt } = req.body;
        const adminId = req.user.id;

        // Check if post exists and is active (approved/published)
        const post = await prisma.post.findUnique({
            where: { id: postId }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        if (post.status !== 'active') {
            return res.status(400).json({
                status: 'error',
                message: 'Only active posts can be featured'
            });
        }

        if (post.is_frozen) {
            return res.status(400).json({
                status: 'error',
                message: 'Frozen posts cannot be featured'
            });
        }

        // Check if post is already featured
        const existingFeature = await prisma.featuredPost.findFirst({
            where: {
                post_id: postId,
                is_active: true
            }
        });

        if (existingFeature) {
            return res.status(400).json({
                status: 'error',
                message: 'Post is already featured'
            });
        }

        // Create featured post
        const featuredPost = await prisma.featuredPost.create({
            data: {
                post_id: postId,
                featured_by: adminId,
                reason: reason || 'Featured by admin',
                expires_at: expiresAt ? new Date(expiresAt) : null,
                is_active: true
            },
            include: {
                post: {
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
                        }
                    }
                },
                admin: {
                    select: {
                        id: true,
                        username: true
                    }
                }
            }
        });

        // Update post to mark as featured
        await prisma.post.update({
            where: { id: postId },
            data: {
                is_featured: true,
                featured_at: new Date()
            }
        });

        // Clear cache for all posts and featured posts
        await clearCacheByPattern(CACHE_KEYS.ALL_POSTS);
        await clearCacheByPattern(CACHE_KEYS.FEATURED_POSTS);

        // Notify post owner (userID must be username, not user ID)
        if (featuredPost.post.user?.username) {
            const notification = await prisma.notification.create({
                data: {
                    userID: featuredPost.post.user.username,
                    message: 'Your post has been featured!',
                    type: 'post_featured',
                    isRead: false
                }
            });
            
            // Emit real-time notification event
            emitEvent('notification:created', {
                userId: featuredPost.post.user.id,
                userID: featuredPost.post.user.username,
                notification: {
                    id: notification.id,
                    type: notification.type,
                    message: notification.message,
                    isRead: notification.isRead,
                    createdAt: notification.createdAt
                }
            });
        }

        res.status(201).json({
            status: 'success',
            message: 'Post featured successfully',
            data: {
                featuredPost: {
                    id: featuredPost.id,
                    post: featuredPost.post,
                    reason: featuredPost.reason,
                    featuredAt: featuredPost.createdAt,
                    expiresAt: featuredPost.expires_at,
                    featuredBy: featuredPost.admin.username
                }
            }
        });

    } catch (error) {
        console.error('Feature post error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error featuring post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Unfeature a post (Admin only)
exports.unfeaturePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const adminId = req.user.id;

        // Find active featured post
        const featuredPost = await prisma.featuredPost.findFirst({
            where: {
                post_id: postId,
                is_active: true
            }
        });

        if (!featuredPost) {
            return res.status(404).json({
                status: 'error',
                message: 'Post is not currently featured'
            });
        }

        // Deactivate featured post
        await prisma.featuredPost.update({
            where: { id: featuredPost.id },
            data: {
                is_active: false
            }
        });

        // Update post to remove featured status
        await prisma.post.update({
            where: { id: postId },
            data: {
                is_featured: false,
                featured_at: null
            }
        });

        // Clear cache for all posts and featured posts
        await clearCacheByPattern(CACHE_KEYS.ALL_POSTS);
        await clearCacheByPattern(CACHE_KEYS.FEATURED_POSTS);

        res.json({
            status: 'success',
            message: 'Post unfeatured successfully'
        });

    } catch (error) {
        console.error('Unfeature post error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error unfeaturing post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all featured posts (Admin only)
exports.getAllFeaturedPosts = async (req, res) => {
    try {
        const { page = 1, limit = 10, active } = req.query;
        const offset = (page - 1) * limit;

        const whereClause = {};
        if (active !== undefined) {
            whereClause.is_active = active === 'true';
        }

        const [featuredPosts, totalCount] = await Promise.all([
            prisma.featuredPost.findMany({
                where: whereClause,
                include: {
                    post: {
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
                            }
                        }
                    },
                    admin: {
                        select: {
                            id: true,
                            username: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.featuredPost.count({
                where: whereClause
            })
        ]);

        res.json({
            status: 'success',
            data: {
                featuredPosts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / limit),
                    totalCount,
                    hasNext: page * limit < totalCount,
                    hasPrev: page > 1
                }
            }
        });

    } catch (error) {
        console.error('Get all featured posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching featured posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

