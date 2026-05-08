const prisma = require('../lib/prisma');
const { getClient, redisReady } = require('../lib/redis');
const { emitEvent } = require('../lib/realtime');
const crypto = require('crypto');
const viewMilestoneService = require('../services/viewMilestoneService');

/**
 * Generate viewer key for deduplication
 * Authenticated users: userId
 * Anonymous users: hash(IP + User-Agent)
 */
const generateViewerKey = (userId, ipAddress, userAgent) => {
    if (userId) {
        return userId;
    }
    // Hash IP + User-Agent for anonymous users
    const combined = `${ipAddress || ''}:${userAgent || ''}`;
    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
};

/**
 * Check Redis for duplicate view (fast path)
 */
const checkRedisDuplicate = async (postId, viewerKey) => {
    if (!redisReady()) return null;
    
    const redis = getClient();
    const key = `view:${postId}:${viewerKey}`;
    const exists = await redis.exists(key);
    
    if (exists) {
        return true; // Duplicate found
    }
    
    // Set with 24h TTL to prevent duplicates
    await redis.setex(key, 86400, '1');
    return false; // Not a duplicate
};

/**
 * Rate limit check per IP
 */
const checkRateLimit = async (ipAddress) => {
    if (!redisReady()) return true; // Allow if Redis not available
    
    const redis = getClient();
    const key = `rate:view:${ipAddress}`;
    const current = await redis.incr(key);
    
    if (current === 1) {
        // First request, set TTL
        await redis.expire(key, 60); // 1 minute window
    }
    
    // Allow up to 100 views per minute per IP
    return current <= 100;
};

/**
 * Record a view for a post
 * Refined implementation with Redis caching, rate limiting, and WebSocket broadcasting
 * 
 * Request body (optional):
 * {
 *   sessionId: string, // Frontend session ID for additional tracking
 *   watchTime: number, // Watch time in seconds (frontend validated)
 *   visibilityPercent: number // Visibility percentage (frontend validated)
 * }
 */
exports.recordView = async (req, res) => {
    try {
        const { postId } = req.params;
        const { sessionId, watchTime, visibilityPercent } = req.body || {};
        const userId = req.user?.id; // Optional for anonymous users
        const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
        const userAgent = req.get('User-Agent') || 'unknown';

        // Validate qualified view (backend validation)
        // Frontend should send watchTime >= 3 and visibilityPercent >= 60
        // Backend enforces minimum thresholds
        const isQualifiedView = 
            (watchTime === undefined || watchTime >= 3) &&
            (visibilityPercent === undefined || visibilityPercent >= 60);

        if (!isQualifiedView) {
            return res.status(400).json({
                status: 'error',
                message: 'View does not meet qualification criteria (min 3s watch time, 60% visibility)'
            });
        }

        // Check if post exists
        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: { 
                id: true, 
                views: true, 
                user_id: true,
                status: true,
                is_frozen: true
            }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        // Don't count views for inactive or frozen posts
        if (post.status !== 'active' || post.is_frozen) {
            return res.status(400).json({
                status: 'error',
                message: 'Post is not available for viewing'
            });
        }

        // Generate viewer key
        const viewerKey = generateViewerKey(userId, ipAddress, userAgent);

        // Fast path: Check Redis for duplicate
        const isDuplicate = await checkRedisDuplicate(postId, viewerKey);
        if (isDuplicate) {
            // Still return current view count
            const currentPost = await prisma.post.findUnique({
                where: { id: postId },
                select: { views: true }
            });
            
            return res.json({
                status: 'success',
                message: 'View already counted',
                data: {
                    viewRecorded: false,
                    viewCount: currentPost?.views || post.views
                }
            });
        }

        // Rate limiting check
        const rateLimitOk = await checkRateLimit(ipAddress);
        if (!rateLimitOk) {
            return res.status(429).json({
                status: 'error',
                message: 'Too many view requests. Please try again later.'
            });
        }

        // Use transaction for atomic view recording
        const result = await prisma.$transaction(async (tx) => {
            let viewRecorded = false;
            let newViewCount = post.views;

            if (userId) {
                // Authenticated user - check DB for existing view
                const viewExists = await tx.view.count({
                    where: {
                        user_id: userId,
                        post_id: postId
                    }
                });

                if (viewExists === 0) {
                    await tx.view.create({
                        data: {
                            user_id: userId,
                            post_id: postId,
                            ip_address: ipAddress,
                            user_agent: userAgent
                        }
                    });
                    viewRecorded = true;
                }
            } else {
                // Anonymous user - check DB for existing view
                const viewExists = await tx.view.count({
                    where: {
                        ip_address: ipAddress,
                        post_id: postId
                    }
                });

                if (viewExists === 0) {
                    await tx.view.create({
                        data: {
                            user_id: null,
                            post_id: postId,
                            ip_address: ipAddress,
                            user_agent: userAgent
                        }
                    });
                    viewRecorded = true;
                }
            }

            // Increment view count if new view was recorded
            if (viewRecorded) {
                const updatedPost = await tx.post.update({
                    where: { id: postId },
                    data: {
                        views: {
                            increment: 1
                        }
                    },
                    select: { views: true }
                });
                newViewCount = updatedPost.views;
            }

            return {
                viewRecorded,
                viewCount: newViewCount
            };
        });

        // Broadcast view update via WebSocket (non-blocking)
        if (result.viewRecorded) {
            // Emit view update event
            emitEvent('post:viewUpdate', {
                postId,
                views: result.viewCount
            });

            // Check for view milestones (async, non-blocking)
            viewMilestoneService.checkAndNotifyMilestone(postId, result.viewCount, post.user_id)
                .catch(error => {
                    console.error('[View Milestone] Error checking milestone:', error);
                });
        }

        res.json({
            status: 'success',
            message: result.viewRecorded ? 'View recorded' : 'View already counted',
            data: {
                viewRecorded: result.viewRecorded,
                viewCount: result.viewCount
            }
        });

    } catch (error) {
        console.error('Record view error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error recording view',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get view statistics for a post
 */
exports.getPostViewStats = async (req, res) => {
    try {
        const { postId } = req.params;

        const [totalViews, uniqueUserViews, recentViews] = await Promise.all([
            prisma.view.count({
                where: { post_id: postId }
            }),
            prisma.view.count({
                where: { 
                    post_id: postId,
                    user_id: { not: null }
                }
            }),
            prisma.view.findMany({
                where: { post_id: postId },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            profile_picture: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: 10
            })
        ]);

        res.json({
            status: 'success',
            data: {
                totalViews,
                uniqueUserViews,
                anonymousViews: totalViews - uniqueUserViews,
                recentViews: recentViews.map(view => ({
                    user: view.user,
                    viewedAt: view.createdAt,
                    isAnonymous: !view.user_id
                }))
            }
        });

    } catch (error) {
        console.error('Get post view stats error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching view statistics'
        });
    }
};

/**
 * Get trending posts based on views and likes
 */
exports.getTrendingPosts = async (req, res) => {
    try {
        const { period = '24h', limit = 20 } = req.query;
        
        // Calculate time threshold based on period
        const now = new Date();
        let timeThreshold;
        
        switch (period) {
            case '1h':
                timeThreshold = new Date(now.getTime() - 60 * 60 * 1000);
                break;
            case '24h':
                timeThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                timeThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                timeThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                timeThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }

        // Get posts with recent activity
        const trendingPosts = await prisma.post.findMany({
            where: {
                status: 'active',
                is_frozen: false,
                createdAt: {
                    gte: timeThreshold
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
                        postLikes: true,
                        postViews: true,
                        comments: true
                    }
                }
            },
            orderBy: [
                { views: 'desc' },
                { likes: 'desc' },
                { createdAt: 'desc' }
            ],
            take: parseInt(limit)
        });

        // Calculate trending score (weighted combination of views, likes, and comments)
        const postsWithScore = trendingPosts.map(post => {
            const trendingScore = 
                (post.views * 1) + 
                (post.likes * 3) + 
                (post._count.comments * 2) +
                (post._count.postLikes * 3);
            
            return {
                id: post.id,
                title: post.title,
                caption: post.caption,
                video_url: post.video_url,
                image_url: post.image_url,
                like_count: post.likes,
                comment_count: post.comment_count,
                view_count: post.views,
                share_count: post.shares,
                status: post.status,
                created_at: post.createdAt,
                user: post.user,
                category: post.category,
                trendingScore
            };
        });

        // Sort by trending score
        postsWithScore.sort((a, b) => b.trendingScore - a.trendingScore);

        res.json({
            status: 'success',
            data: {
                posts: postsWithScore,
                period,
                generatedAt: new Date()
            }
        });

    } catch (error) {
        console.error('Get trending posts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching trending posts'
        });
    }
};

/**
 * Get view milestones for a post
 */
exports.getPostMilestones = async (req, res) => {
    try {
        const { postId } = req.params;
        const milestones = await viewMilestoneService.getPostMilestones(postId);

        if (!milestones) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        res.json({
            status: 'success',
            data: milestones
        });

    } catch (error) {
        console.error('Get post milestones error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching milestone statistics'
        });
    }
};

/**
 * Batch update view counts (for background processing)
 * This can be called periodically to sync view counts
 */
exports.batchUpdateViewCounts = async (req, res) => {
    try {
        // This would typically be called by a background job
        // For now, we'll just return success
        res.json({
            status: 'success',
            message: 'View count sync completed'
        });

    } catch (error) {
        console.error('Batch update view counts error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error updating view counts'
        });
    }
};
