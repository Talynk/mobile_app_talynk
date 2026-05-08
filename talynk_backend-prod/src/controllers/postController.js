const { v4: uuidv4, validate: isUuid } = require('uuid');
const path = require('path');
const prisma = require('../lib/prisma');
const { createClient } = require('@supabase/supabase-js');
const os = require('os');
const fs = require('fs').promises;
const {
    CACHE_KEYS,
    getFollowingPostsCache,
    setFollowingPostsCache,
    getAllPostsCache,
    setAllPostsCache,
    getSinglePostCache,
    setSinglePostCache,
    getSearchCache,
    setSearchCache,
    clearCacheByPattern
} = require('../utils/cache');
const { emitEvent } = require('../lib/realtime');
const { addVideoJob, getJobStatus, getQueueStats } = require('../queues/videoQueue');
const { withVideoPlaybackUrl } = require('../utils/postVideoUtils');
const { getSignedUploadUrl, fileExistsInR2, isR2Configured } = require('../services/r2Storage');
const { getClient: getRedisClient } = require('../lib/redis');
const { applyFeedReadyFilter, getProcessingStatusLabel } = require('../utils/postFilters');
const { invalidatePostCaches } = require('../utils/postCacheInvalidation');
const {
    AD_INTERLEAVE_PATTERN,
    getInterleaveCounts,
    totalInterleavedSize
} = require('../services/recommendation/adInjector');
const affinityService = require('../services/recommendation/affinityService');

const UPLOAD_SESSION_TTL = 600; // 10 minutes
const UPLOAD_SESSION_PREFIX = 'upload:';

/**
 * Create video upload - returns signed URL for direct client upload to R2.
 * POST /api/posts/create-upload
 * Body: { title, caption, post_category, status?: 'draft'|'active' }
 * Client uploads file via PUT to uploadUrl, then calls upload-complete.
 */
exports.createVideoUpload = async (req, res) => {
    try {
        const { title, caption, post_category, status } = req.body;
        const userId = req.user.id;

        if (!title || !post_category) {
            return res.status(400).json({
                status: 'error',
                message: 'title and post_category are required',
            });
        }

        if (!isR2Configured()) {
            return res.status(503).json({
                status: 'error',
                message: 'Direct upload not available. R2 storage is not configured.',
            });
        }

        const redis = getRedisClient();
        if (!redis) {
            return res.status(503).json({
                status: 'error',
                message: 'Direct upload not available. Redis is not configured.',
            });
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const category = await prisma.category.findFirst({
            where: { name: { mode: 'insensitive', equals: post_category.trim() }, status: 'active' },
        });
        if (!category) {
            return res.status(400).json({ status: 'error', message: 'Invalid category' });
        }

        const postStatus = status === 'draft' ? 'draft' : 'active';
        if (postStatus === 'draft') {
            const draftCount = await prisma.post.count({ where: { user_id: userId, status: 'draft' } });
            if (draftCount >= 3) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Maximum draft limit reached',
                });
            }
        }

        const post = await prisma.post.create({
            data: {
                user_id: userId,
                status: postStatus,
                category_id: category.id,
                title,
                description: caption || null,
                content: caption || null,
                type: 'video',
                video_url: null,
                thumbnail_url: null,
                processing_status: 'uploading',
                uploadDate: new Date(),
            },
        });
        await invalidatePostCaches();

        const fileExt = '.mp4';
        const fileName = `${Date.now()}-${uuidv4()}${fileExt}`;
        const r2Key = `media/${fileName}`;

        const { uploadUrl, publicUrl } = await getSignedUploadUrl(r2Key, 'video/mp4', UPLOAD_SESSION_TTL);

        await redis.setex(`${UPLOAD_SESSION_PREFIX}${post.id}`, UPLOAD_SESSION_TTL, r2Key);

        res.json({
            status: 'success',
            data: {
                postId: post.id,
                uploadUrl,
                videoUrl: publicUrl,
                expiresIn: UPLOAD_SESSION_TTL,
            },
        });
    } catch (error) {
        console.error('[createVideoUpload] Error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create upload session',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

/**
 * Complete video upload - verify file in R2, update post, queue processing.
 * POST /api/posts/upload-complete
 * Body: { postId }
 */
exports.completeVideoUpload = async (req, res) => {
    try {
        const { postId } = req.body;
        const userId = req.user.id;

        if (!postId) {
            return res.status(400).json({ status: 'error', message: 'postId is required' });
        }

        const redis = getRedisClient();
        if (!redis) {
            return res.status(503).json({
                status: 'error',
                message: 'Redis not configured',
            });
        }

        const post = await prisma.post.findUnique({
            where: { id: postId },
        });

        if (!post) {
            return res.status(404).json({ status: 'error', message: 'Post not found' });
        }
        if (post.user_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Not authorized' });
        }
        if (post.processing_status !== 'uploading') {
            return res.status(400).json({
                status: 'error',
                message: 'Post is not in uploading state',
                processing_status: post.processing_status,
            });
        }

        const r2Key = await redis.get(`${UPLOAD_SESSION_PREFIX}${postId}`);
        await redis.del(`${UPLOAD_SESSION_PREFIX}${postId}`);

        if (!r2Key) {
            return res.status(400).json({
                status: 'error',
                message: 'Upload session expired or invalid. Please start a new upload.',
            });
        }

        const exists = await fileExistsInR2(r2Key);
        if (!exists) {
            return res.status(400).json({
                status: 'error',
                message: 'Video file not found in storage. Please complete the upload first.',
            });
        }

        const { R2_PUBLIC_DOMAIN } = require('../services/r2Storage');
        const publicVideoUrl = `${R2_PUBLIC_DOMAIN}/${r2Key}`;

        await prisma.post.update({
            where: { id: postId },
            data: {
                video_url: publicVideoUrl,
                processing_status: 'pending',
            },
        });
        await invalidatePostCaches();

        try {
            const queueJob = await addVideoJob(postId, publicVideoUrl);
            console.log('[POST] Video queued (direct upload)', {
                postId,
                jobId: queueJob?.id,
                message: 'Processor should log this jobId when it picks up the job',
            });
        } catch (queueErr) {
            const errMsg = queueErr?.message || 'Failed to queue video for processing';
            console.error('[POST] Failed to queue video job', {
                postId,
                error: errMsg,
                code: queueErr?.code,
            });
            await prisma.post.update({
                where: { id: postId },
                data: {
                    processing_status: 'failed',
                    processing_error: errMsg.slice(0, 500),
                },
            });
            return res.status(500).json({
                status: 'error',
                message: 'Upload complete but processing queue failed. Post left in failed state; you can retry from profile.',
            });
        }

        res.json({
            status: 'success',
            message: 'Upload complete. Video is being processed.',
            data: {
                postId,
                video_url: publicVideoUrl,
                processing_status: 'pending',
            },
        });
    } catch (error) {
        console.error('[completeVideoUpload] Error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to complete upload',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};

exports.createPost = async (req, res) => {
    try {
        const { title, caption, post_category } = req.body;
        const userId = req.user.id;
        console.log("Request headers:", req.headers);
        console.log("Content-Type:", req.headers['content-type']);
        console.log("Request body:", req.body);
        console.log("Request file:", req.file);
        console.log("post_category ----->", post_category)

        // Validate that the user exists
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found',
                user_id: userId
            });
        }

        console.log("User found:", user.username || user.email);

        // First, get the category ID from the category name (can be main category or subcategory)
        const category = await prisma.category.findFirst({
            where: {
                name: {
                    mode: 'insensitive',
                    equals: post_category.trim()
                },
                status: 'active'
            }
        });
        console.log("found category ----->", category);

        if (!category) {
            // Get available categories for error message
            const availableCategories = await prisma.category.findMany({
                where: { status: 'active' },
                select: { name: true, level: true, parent_id: true },
                orderBy: [
                    { level: 'asc' },
                    { sort_order: 'asc' }
                ]
            });

            return res.status(400).json({
                status: 'error',
                message: 'Invalid category',
                received_category: post_category,
                available_categories: availableCategories.map(cat => ({
                    name: cat.name,
                    level: cat.level === 1 ? 'main' : 'subcategory',
                    parent_id: cat.parent_id
                }))
            });
        }

        console.log("Category found:", category.name, "(ID:", category.id + ")");

        // Determine post status: draft if status is provided as 'draft', otherwise 'active' (published immediately)
        const postStatus = req.body.status === 'draft' ? 'draft' : 'active';

        // Check draft limit: users can only have a maximum of 3 draft posts
        if (postStatus === 'draft') {
            const draftCount = await prisma.post.count({
                where: {
                    user_id: userId,
                    status: 'draft'
                }
            });

            if (draftCount >= 3) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Maximum draft limit reached',
                    details: 'You can only have a maximum of 3 draft posts. Please publish or delete existing drafts before creating a new one.',
                    currentDraftCount: draftCount,
                    maxDrafts: 3
                });
            }
        }
        // Handle file upload - Media is required for post creation
        if (!req.file) {
            return res.status(400).json({
                status: 'error',
                message: 'Media file is required',
                details: 'A valid image or video file must be uploaded to create a post. Please ensure the file is included in the request with the field name "file".'
            });
        }

        // Verify that the file upload was successful
        const video_url = req.file.r2Url || req.file.localUrl || req.file.supabaseUrl || '';

        if (!video_url || video_url.trim() === '') {
            return res.status(400).json({
                status: 'error',
                message: 'Media upload failed',
                details: 'The file upload was not successful. Please try again with a valid image or video file.'
            });
        }

        // Verify file type is valid (image or video)
        const isValidMediaType = req.file.mimetype.startsWith('image/') || req.file.mimetype.startsWith('video/');
        if (!isValidMediaType) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid file type',
                details: 'Only image and video files are allowed. Please upload a valid image (jpg, png, gif, etc.) or video (mp4, mov, etc.) file.',
                received_mimetype: req.file.mimetype
            });
        }

        // Determine file type
        const fileType = req.file.mimetype.startsWith('image') ? 'image' : 'video';
        const filePath = req.file.path;
        const mimetype = req.file.mimetype;

        console.log("File uploaded successfully:", {
            url: video_url,
            filename: req.file.filename,
            path: req.file.path,
            mimetype: req.file.mimetype,
            size: req.file.size,
            storage: req.file.r2Url ? 'R2' : 'local'
        });

        // Prepare video-specific data
        const isVideo = fileType === 'video';
        const processingStatus = isVideo ? 'pending' : null;

        const post = await prisma.post.create({
            data: {
                user_id: userId,
                status: postStatus, // Default to active (published immediately), can be set to draft
                category_id: category.id,  // Use the category ID instead of name
                title,
                description: caption,
                uploadDate: new Date(),
                type: fileType,
                video_url,
                thumbnail_url: null, // Will be populated by background thumbnail generation
                processing_status: processingStatus, // HLS processing status
                content: caption
            }
        });

        console.log("Post created successfully:", post.id);


        // Add video to processing queue for HLS transcoding
        // Note: Thumbnails are now generated on the frontend and passed in the request
        if (isVideo && video_url) {
            console.log("[POST] Adding video to processing queue for post:", post.id);
            try {
                const queueJob = await addVideoJob(post.id, video_url);
                console.log('[POST] Video queued', { postId: post.id, jobId: queueJob?.id });
            } catch (queueErr) {
                const errMsg = queueErr?.message || 'Failed to queue video for processing';
                console.error('[POST] Failed to queue video job', { postId: post.id, error: errMsg });
                await prisma.post.update({
                    where: { id: post.id },
                    data: {
                        processing_status: 'failed',
                        processing_error: errMsg.slice(0, 500),
                    },
                });
            }
        }

        // Optionally link post to challenge if challenge_id is provided
        let challengePost = null;
        let challengeLinkError = null;
        let challengeMaxContentPerAccount = null;
        if (req.body.challenge_id) {
            try {
                const challengeId = req.body.challenge_id;

                // Check if challenge exists and is active
                const challenge = await prisma.challenge.findUnique({
                    where: { id: challengeId }
                });

                if (challenge && (challenge.status === 'active' || challenge.status === 'approved')) {
                    // Check if user is a participant
                    const participant = await prisma.challengeParticipant.findUnique({
                        where: {
                            unique_challenge_participant: {
                                challenge_id: challengeId,
                                user_id: userId
                            }
                        }
                    });

                    if (participant) {
                        // Check if post is already linked
                        const existingLink = await prisma.challengePost.findUnique({
                            where: {
                                unique_challenge_post: {
                                    challenge_id: challengeId,
                                    post_id: post.id
                                }
                            }
                        });

                        if (!existingLink) {
                            challengeMaxContentPerAccount = challenge.max_content_per_account != null
                                ? challenge.max_content_per_account
                                : 5;
                            const currentCount = await prisma.challengePost.count({
                                where: {
                                    challenge_id: challengeId,
                                    user_id: userId
                                }
                            });
                            if (currentCount >= challengeMaxContentPerAccount) {
                                challengeLinkError = 'MAX_CHALLENGE_POSTS_REACHED';
                            } else {
                                challengePost = await prisma.challengePost.create({
                                    data: {
                                        challenge_id: challengeId,
                                        post_id: post.id,
                                        user_id: userId
                                    }
                                });
                                console.log("Post linked to challenge:", challengeId);
                            }
                        }
                    } else {
                        console.log("User is not a participant in the challenge, skipping link");
                    }
                } else {
                    console.log("Challenge not found or not active, skipping link");
                }
            } catch (error) {
                console.error("Error linking post to challenge:", error);
                // Don't fail post creation if challenge linking fails
            }
        }

        // Update user's post count
        await prisma.user.update({
            where: { id: userId },
            data: {
                posts_count: {
                    increment: 1
                }
            }
        });

        await invalidatePostCaches();

        emitEvent('post:created', { postId: post.id, userId: userId });

        // Send response immediately
        res.status(201).json({
            status: 'success',
            data: {
                post: {
                    ...post,
                    video_url: video_url,
                    thumbnail_url: null, // Generated async in background
                    // HLS processing info
                    hls_processing: isVideo ? {
                        status: 'pending',
                        message: 'Video is being processed for adaptive streaming. HLS URL will be available shortly.'
                    } : null,
                    challenge_linked: challengePost ? true : false,
                    challenge_id: challengePost ? challengePost.challenge_id : null,
                    challenge_link_error: challengeLinkError,
                    challenge_max_content_per_account: challengeMaxContentPerAccount
                }
            }
        });
    } catch (error) {
        console.error('Post creation error:', error);

        // Handle specific Prisma errors
        if (error.code === 'P2003') {
            return res.status(400).json({
                status: 'error',
                message: 'Foreign key constraint violation. User or category not found.',
                details: error.meta
            });
        }

        if (error.code === 'P2002') {
            return res.status(400).json({
                status: 'error',
                message: 'Unique constraint violation. Post with this data already exists.',
                details: error.meta
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Error creating post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getAllPosts = async (req, res) => {
    try {
        const {
            country_id,
            page = 1,
            limit = 20,
            sort = 'default', // default, newest, oldest, most_liked, most_viewed, most_commented
            status = 'active', // active, all, pending, suspended
            category_id,
            subcategory_id,
            featured_first = 'true' // true by default
        } = req.query;

        const offset = (page - 1) * limit;
        const shouldFeatureFirst = featured_first === 'true';

        // Create cache key with all parameters
        const cacheKey = `${CACHE_KEYS.ALL_POSTS}_${page}_${limit}_${sort}_${status}_${category_id || 'all'}_${subcategory_id || 'all'}_${country_id || 'all'}_${featured_first}`;

        // Try to get from cache first
        const cachedData = await getAllPostsCache(cacheKey);
        if (cachedData) {
            console.log('Serving all posts from cache');
            return res.json({
                status: 'success',
                data: cachedData,
                cached: true
            });
        }

        // Build base where clause
        const baseWhereClause = {
            is_frozen: false
        };

        // Filter by status - ensure valid PostStatus enum value
        if (status && status !== 'all') {
            // Validate status is a valid PostStatus enum value
            if (['draft', 'active', 'suspended'].includes(status)) {
                baseWhereClause.status = status;
            } else {
                baseWhereClause.status = 'active';
            }
        } else if (status === 'all') {
            // Include all statuses except frozen
        } else {
            baseWhereClause.status = 'active';
        }

        // Filter by category (main category) or subcategory
        if (subcategory_id) {
            // If subcategory_id is provided, filter by that specific subcategory
            baseWhereClause.category_id = parseInt(subcategory_id);
        } else if (category_id) {
            // If only category_id is provided, filter by main category
            // Get all subcategories of this main category
            const subcategories = await prisma.category.findMany({
                where: {
                    parent_id: parseInt(category_id),
                    level: 2,
                    status: 'active'
                },
                select: { id: true }
            });

            const subcategoryIds = subcategories.map(s => s.id);
            // Include both the main category and all its subcategories
            baseWhereClause.category_id = {
                in: [parseInt(category_id), ...subcategoryIds]
            };
        }

        // Determine sort order for non-featured posts.
        // When sorting by likes/views/comments, tie-break by latest first (createdAt desc).
        let orderBy = {};
        switch (sort) {
            case 'newest':
                orderBy = { createdAt: 'desc' };
                break;
            case 'oldest':
                orderBy = { createdAt: 'asc' };
                break;
            case 'most_liked':
                orderBy = [{ likes: 'desc' }, { createdAt: 'desc' }];
                break;
            case 'most_viewed':
                orderBy = [{ views: 'desc' }, { createdAt: 'desc' }];
                break;
            case 'most_commented':
                orderBy = [{ comment_count: 'desc' }, { createdAt: 'desc' }];
                break;
            case 'default':
            default:
                // Default: most liked for non-featured posts; same likes → latest first
                orderBy = [{ likes: 'desc' }, { createdAt: 'desc' }];
                break;
        }

        const currentDate = new Date();

        // Only show video posts in feed when processing is complete
        const feedReadyBaseWhere = applyFeedReadyFilter(baseWhereClause);
        // Exclude ads from featured and from regular content; ads are interleaved separately
        const feedReadyNoAds = { ...feedReadyBaseWhere, is_ad: false };

        // Get featured posts first (if featured_first is true) — never include ads as featured
        let featuredPosts = [];
        let featuredPostIds = [];

        if (shouldFeatureFirst) {
            // Get all active featured posts from FeaturedPost table that haven't expired
            const postFilter = { ...feedReadyNoAds, is_frozen: false };

            const activeFeaturedPosts = await prisma.featuredPost.findMany({
                where: {
                    is_active: true,
                    OR: [
                        { expires_at: null },
                        { expires_at: { gt: currentDate } }
                    ],
                    post: postFilter
                },
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
                                    level: true,
                                    parent_id: true,
                                    parent: {
                                        select: {
                                            id: true,
                                            name: true,
                                            level: true
                                        }
                                    }
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
                            username: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc' // Featured posts by newest first
                }
            });

            featuredPosts = activeFeaturedPosts.map(fp => ({
                ...fp.post,
                isFeatured: true,
                featuredAt: fp.createdAt,
                expiresAt: fp.expires_at,
                featuredBy: fp.admin?.username,
                featuredReason: fp.reason
            }));

            featuredPostIds = featuredPosts.map(fp => fp.id);

            // Also get posts with is_featured: true that don't have FeaturedPost entries
            // (posts featured via the alternative route)
            const postsWithFeaturedFlag = await prisma.post.findMany({
                where: {
                    ...feedReadyNoAds,
                    is_featured: true,
                    id: {
                        notIn: featuredPostIds // Exclude already found featured posts
                    }
                },
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
                            level: true,
                            parent_id: true,
                            parent: {
                                select: {
                                    id: true,
                                    name: true,
                                    level: true
                                }
                            }
                        }
                    },
                    _count: {
                        select: {
                            comments: true,
                            postLikes: true,
                            postViews: true
                        }
                    }
                },
                orderBy: {
                    featured_at: 'desc' // Sort by when it was featured
                }
            });

            // Add posts with is_featured flag to featured posts list
            const additionalFeatured = postsWithFeaturedFlag.map(post => ({
                ...post,
                isFeatured: true,
                featuredAt: post.featured_at || post.createdAt,
                expiresAt: null,
                featuredBy: null,
                featuredReason: null
            }));

            featuredPosts = [...featuredPosts, ...additionalFeatured];
            featuredPostIds = featuredPosts.map(fp => fp.id);
        }

        // Build where clause for regular posts (exclude featured and ads; ads interleaved separately)
        const regularWhereClause = {
            ...feedReadyNoAds
        };

        if (shouldFeatureFirst && featuredPostIds.length > 0) {
            regularWhereClause.id = {
                notIn: featuredPostIds
            };
        }

        // Calculate pagination for combined results
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const featuredCount = featuredPosts.length;

        // Determine how many featured posts to show on this page
        let featuredOnPage = [];
        let regularOffset = offset;
        let regularLimit = limitNum;

        if (shouldFeatureFirst && featuredCount > 0) {
            // Calculate which featured posts belong on this page
            const featuredStart = Math.max(0, offset);
            const featuredEnd = Math.min(featuredCount, offset + limitNum);

            if (featuredStart < featuredCount) {
                featuredOnPage = featuredPosts.slice(featuredStart, featuredEnd);
                regularLimit = limitNum - featuredOnPage.length;
                // If we've shown all featured posts, adjust offset for regular posts
                if (featuredEnd >= featuredCount) {
                    regularOffset = Math.max(0, offset - featuredCount);
                } else {
                    // Still showing featured posts, so no regular posts needed
                    regularLimit = 0;
                }
            }
        }

        // Ads pool (feed-ready, for interleaving)
        const adsWhere = applyFeedReadyFilter({ is_ad: true, status: 'active' });
        const [regularPosts, totalRegular, adsList] = await Promise.all([
            regularLimit > 0 ? (() => {
                const { contentSkip, contentTake, adSkip, adTake } = getInterleaveCounts(regularOffset, regularLimit);
                return prisma.post.findMany({
                    where: regularWhereClause,
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
                                level: true,
                                parent_id: true,
                                parent: {
                                    select: {
                                        id: true,
                                        name: true,
                                        level: true
                                    }
                                }
                            }
                        },
                        _count: {
                            select: {
                                comments: true,
                                postLikes: true,
                                postViews: true
                            }
                        }
                    },
                    orderBy: orderBy,
                    take: contentTake,
                    skip: contentSkip
                });
            })() : Promise.resolve([]),
            prisma.post.count({
                where: regularWhereClause
            }),
            prisma.post.findMany({
                where: adsWhere,
                orderBy: { createdAt: 'desc' },
                take: 200,
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
                            name: true,
                            level: true,
                            parent_id: true,
                            parent: { select: { id: true, name: true, level: true } }
                        }
                    },
                    _count: {
                        select: { comments: true, postLikes: true, postViews: true }
                    }
                }
            })
        ]);

        // Build interleaved list (5 posts, 1 ad, 8 posts, 1 ad, ...) for this page's "rest" segment
        let restSegment = [];
        if (regularLimit > 0) {
            const { contentSkip, contentTake, adSkip, adTake } = getInterleaveCounts(regularOffset, regularLimit);
            const content = regularPosts;
            const ads = adsList;
            let c = 0, a = 0, k = 0;
            let p = 0;
            while (k < regularLimit) {
                let insertedThisCycle = 0;
                for (let i = 0; i < AD_INTERLEAVE_PATTERN[p] && c < content.length && k < regularLimit; i++) {
                    restSegment.push(content[c]);
                    c++;
                    k++;
                    insertedThisCycle++;
                }
                if (k < regularLimit && adTake > 0 && ads.length > 0) {
                    const ad = ads[(adSkip + a) % ads.length];
                    restSegment.push({ ...ad, isAd: true });
                    a++;
                    k++;
                    insertedThisCycle++;
                }
                // Prevent infinite loops when there is no more content/ad to interleave.
                if (insertedThisCycle === 0) {
                    break;
                }
                p = 1 - p;
            }
        }

        // Combine featured and interleaved (content + ads) segment
        const allPosts = shouldFeatureFirst
            ? [...featuredOnPage, ...restSegment]
            : restSegment;

        // Total count: featured + interleaved size (content count -> item count via pattern)
        const totalRestItems = totalInterleavedSize(totalRegular);
        const totalCount = shouldFeatureFirst
            ? featuredCount + totalRestItems
            : totalRestItems;

        // Add full URLs for playback (HLS when ready, else raw), isAd flag, and enrich with category info
        const postsWithUrls = allPosts.map(post => {
            const p = withVideoPlaybackUrl(post);
            p.isAd = !!post.isAd;
            // Enrich with main category and subcategory info
            if (post.category) {
                if (post.category.level === 2 && post.category.parent) {
                    p.mainCategory = {
                        id: post.category.parent.id,
                        name: post.category.parent.name,
                        level: post.category.parent.level
                    };
                    p.subCategory = { id: post.category.id, name: post.category.name, level: post.category.level };
                } else if (post.category.level === 1) {
                    p.mainCategory = { id: post.category.id, name: post.category.name, level: post.category.level };
                    p.subCategory = null;
                }
            }
            return p;
        });

        const responseData = {
            posts: postsWithUrls,
            pagination: {
                total: totalCount,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(totalCount / limitNum),
                featuredCount: shouldFeatureFirst ? featuredCount : 0
            },
            filters: {
                sort,
                status,
                category_id: category_id || null,
                subcategory_id: subcategory_id || null,
                country_id: null, // Disabled for now
                featured_first: shouldFeatureFirst
            }
        };

        // Cache the response
        await setAllPostsCache(cacheKey, responseData);

        res.json({
            status: 'success',
            data: responseData,
            cached: false
        });
    } catch (error) {
        console.error('Error getting posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error getting posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.getPostById = async (req, res) => {
    try {
        const postId = req.params.postId;
        console.log("postId ----->", postId);
        console.log(`Attempting to find post with ID: ${postId}`);

        // Check for common non-UUID route conflicts
        const reservedRoutes = ['following', 'feed', 'user', 'all', 'search'];
        if (reservedRoutes.includes(postId)) {
            console.error('Reserved route used as post ID:', postId);
            return res.status(400).json({
                status: 'error',
                message: 'Invalid post ID',
                details: `"${postId}" is a reserved route. Please use the correct endpoint: /api/follows/posts for following posts.`
            });
        }

        // Validate UUID format before querying Prisma
        if (!isUuid(postId)) {
            console.error('Invalid UUID format:', postId);
            return res.status(400).json({
                status: 'error',
                message: 'Invalid post ID format',
                details: `Expected UUID format, got: ${postId}. If you're trying to fetch posts from followed users, use: /api/follows/posts`
            });
        }

        // Create cache key
        const cacheKey = `${CACHE_KEYS.SINGLE_POST}_${postId}`;

        // Try to get from cache first
        const cachedData = await getSinglePostCache(cacheKey);
        if (cachedData) {
            console.log('Serving single post from cache');
            return res.json({
                status: 'success',
                data: cachedData,
                cached: true
            });
        }

        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
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
                        description: true,
                        level: true,
                        parent_id: true,
                        parent: {
                            select: {
                                id: true,
                                name: true,
                                level: true
                            }
                        }
                    }
                },
                comments: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                profile_picture: true
                            }
                        }
                    },
                    orderBy: {
                        comment_date: 'desc'
                    }
                },
                _count: {
                    select: {
                        postLikes: true,
                        comments: true,
                        postViews: true
                    }
                },
                challengePosts: {
                    select: {
                        likes_at_challenge_end: true,
                        challenge_id: true,
                        challenge: {
                            select: {
                                id: true,
                                name: true,
                                status: true,
                                end_date: true
                            }
                        }
                    }
                }
            }
        });

        if (!post) {
            console.log(`Post with ID ${postId} not found`);
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        // Check if post is draft - only owner can view draft posts
        if (post.status === 'draft') {
            // If user is authenticated and is the owner, allow access
            if (req.user && req.user.id === post.user_id) {
                // Owner can view their own draft
            } else {
                // Non-owners cannot view draft posts
                return res.status(404).json({
                    status: 'error',
                    message: 'Post not found'
                });
            }
        }

        // Add full URL for playback (HLS when ready, else raw) and enrich with category info
        const postWithUrl = withVideoPlaybackUrl(post);
        if (post.category) {
            if (post.category.level === 2 && post.category.parent) {
                postWithUrl.mainCategory = { id: post.category.parent.id, name: post.category.parent.name, level: post.category.parent.level };
                postWithUrl.subCategory = { id: post.category.id, name: post.category.name, level: post.category.level };
            } else if (post.category.level === 1) {
                postWithUrl.mainCategory = { id: post.category.id, name: post.category.name, level: post.category.level };
                postWithUrl.subCategory = null;
            }
        }

        const responseData = { post: postWithUrl };

        // Cache the response
        await setSinglePostCache(cacheKey, responseData);

        console.log(`Post with associations retrieved successfully`);
        res.json({
            status: 'success',
            data: responseData,
            cached: false
        });
    } catch (error) {
        console.error('Error getting post:', error);

        // Handle Prisma UUID parsing errors
        if (error.message && error.message.includes('UUID') && error.message.includes('invalid character')) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid post ID format',
                details: `The provided post ID is not a valid UUID. If you're trying to fetch posts from followed users, use: /api/follows/posts`
            });
        }

        // Handle Prisma not found errors
        if (error.code === 'P2025') {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Error fetching post',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.updatePost = async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;

        // Check if post exists and belongs to user
        const existingPost = await prisma.post.findFirst({
            where: {
                id: postId,
                user_id: userId
            }
        });

        if (!existingPost) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found or you do not have permission to update it'
            });
        }

        const updatedPost = await prisma.post.update({
            where: { id: postId },
            data: req.body,
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                },
                category: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        await clearCacheByPattern('single_post');
        await clearCacheByPattern('all_posts');
        await clearCacheByPattern('following_posts');
        await clearCacheByPattern('featured_posts');
        await clearCacheByPattern('search_posts');
        await clearCacheByPattern('feed:');

        emitEvent('post:updated', { postId, userId });

        res.json({
            status: 'success',
            data: { post: updatedPost }
        });
    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error updating post'
        });
    }
};

exports.deletePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const userID = req.user.id;

        // Check if post exists and belongs to user
        const post = await prisma.post.findFirst({
            where: {
                id: postId,
                user_id: userID
            }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found or unauthorized'
            });
        }

        // Delete related records first (comments don't have cascade delete)
        // Delete comments
        await prisma.comment.deleteMany({
            where: { post_id: postId }
        });

        // Delete featured post associations
        await prisma.featuredPost.deleteMany({
            where: { post_id: postId }
        });

        // Note: PostLike, Share, View have cascade delete, so they'll be deleted automatically
        // Note: PostReport and PostAppeal are kept for admin review (not deleted)

        // Delete the post
        await prisma.post.delete({
            where: { id: postId }
        });

        // Update user's post count
        await prisma.user.update({
            where: { id: userID },
            data: {
                posts_count: {
                    decrement: 1
                }
            }
        });

        await clearCacheByPattern('single_post');
        await clearCacheByPattern('all_posts');
        await clearCacheByPattern('following_posts');
        await clearCacheByPattern('featured_posts');
        await clearCacheByPattern('search_posts');
        await clearCacheByPattern('feed:');

        emitEvent('post:deleted', { postId, userId: userID });

        res.json({
            status: 'success',
            message: 'Post deleted successfully'
        });
    } catch (error) {
        console.error('Post deletion error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error deleting post'
        });
    }
};

exports.getPostsByUser = async (req, res) => {
    try {

        console.log("user id -->", req.user.id);

        const posts = await prisma.post.findMany({
            where: { user_id: req.user.id },
            include: {
                category: {
                    select: {
                        id: true,
                        name: true,
                        description: true
                    }
                },
                _count: {
                    select: {
                        postLikes: true,
                        comments: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        res.json({
            status: 'success',
            data: posts
        });

    } catch (error) {
        console.error('Error fetching user posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching user posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Deprecated: Use getUserDraftPosts instead
exports.getPendingPosts = async (req, res) => {
    try {
        const posts = await prisma.post.findMany({
            where: { status: 'draft' },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true
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
                        postLikes: true,
                        comments: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Process media URLs
        const processedPosts = posts.map(post => {
            const postObj = { ...post };
            if (postObj.video_url && !postObj.video_url.startsWith('http')) {
                postObj.video_url = `/uploads/${postObj.video_url.replace(/^uploads\//, '')}`;
            }
            return postObj;
        });

        res.json({
            status: 'success',
            data: processedPosts
        });

    } catch (error) {
        console.error('Error fetching pending posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching posts'
        });
    }
};

exports.updatePostStatus = async (req, res) => {
    try {
        console.log('Updating post status:', req.params.id, req.body); // Debug log

        const { id } = req.params;
        const { status, rejectionReason } = req.body;

        if (!['draft', 'active', 'suspended'].includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid status value. Must be one of: draft, active, suspended'
            });
        }

        const post = await prisma.post.findUnique({
            where: { id: id }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        const updateData = {
            status: status
        };

        const updatedPost = await prisma.post.update({
            where: { id: id },
            data: updateData,
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                },
                category: {
                    select: {
                        id: true,
                        name: true,
                        description: true
                    }
                }
            }
        });

        // Check and auto-suspend user if they have 3+ suspended posts
        if (status === 'suspended' && updatedPost.user?.id) {
            const { checkAndSuspendUser } = require('../utils/userSuspensionService');
            const suspensionResult = await checkAndSuspendUser(updatedPost.user.id, id);

            if (suspensionResult.suspended) {
                console.log(`[Post Controller] User ${updatedPost.user?.username} automatically suspended: ${suspensionResult.message}`);
            }
        }

        await invalidatePostCaches();

        console.log('Post updated:', updatedPost); // Debug log

        res.json({
            status: 'success',
            message: 'Post status updated successfully',
            data: updatedPost
        });

    } catch (error) {
        console.error('Error updating post status:', error); // Debug log
        res.status(500).json({
            status: 'error',
            message: 'Error updating post status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Deprecated: Use getUserDraftPosts instead
exports.getUserPendingPosts = async (req, res) => {
    try {
        const posts = await prisma.post.findMany({
            where: {
                user_id: req.user.id,
                status: 'draft'
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true
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
                        postLikes: true,
                        comments: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        console.log(`Found ${posts.length} draft posts for user ${req.user.id}`);

        res.json({
            status: 'success',
            data: posts
        });

    } catch (error) {
        console.error('Error fetching user pending posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching draft posts'
        });
    }
};

exports.getUserPosts = async (req, res) => {
    try {

        // Get active posts, drafts, and suspended posts for the user (owner can see all their posts including suspended for appeal)
        const posts = await prisma.post.findMany({
            where: {
                user_id: req.user.id,
                status: {
                    in: ['active', 'draft', 'suspended'] // Owner can see all their posts including suspended ones
                }
            },
            include: {
                user: {
                    select: {
                        username: true,
                        email: true,
                        profile_picture: true
                    }
                },
                category: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                postLikes: {
                    select: {
                        user_id: true
                    }
                },
                _count: {
                    select: {
                        postLikes: true,
                        comments: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Add full URLs for playback (HLS when ready, else raw)
        const postsWithUrls = posts.map(post => withVideoPlaybackUrl(post));
        res.json({
            status: 'success',
            data: { posts: postsWithUrls }
        });
    } catch (error) {
        console.error('Posts fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all active posts (replaces getApprovedPosts)
exports.getActivePosts = async (req, res) => {
    try {
        const posts = await prisma.post.findMany({
            where: { status: 'active' },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true
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
                        postLikes: true,
                        comments: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        const processedPosts = posts.map(post => {
            const postObj = post.toJSON();
            if (postObj.mediaUrl && !postObj.mediaUrl.startsWith('http')) {
                postObj.mediaUrl = `/uploads/${postObj.mediaUrl.replace(/^uploads\//, '')}`;
            }
            return postObj;
        });

        res.json({
            status: 'success',
            data: processedPosts
        });

    } catch (error) {
        console.error('Error fetching approved posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching posts'
        });
    }
};

// Removed: getUserApprovedPosts, getUserRejectedPosts, getRejectedPosts
// These used Sequelize models which are not available in this Prisma-based codebase
// Use getUserPosts to get active and draft posts, or admin endpoints for suspended posts

// Removed: approvePost and rejectPost - posts are now published directly as 'active'
// Use updatePostStatus endpoint to change post status to 'active' or 'suspended'

// Deprecated: Use getAllPosts or getPostById instead
exports.getPosts = async (req, res) => {
    res.status(410).json({
        status: 'deprecated',
        message: 'This endpoint is deprecated. Please use /api/posts/all or /api/posts/:postId instead'
    });
};

// Deprecated: Use getPostById instead
exports.getPost = async (req, res) => {
    res.status(410).json({
        status: 'deprecated',
        message: 'This endpoint is deprecated. Please use /api/posts/:postId instead'
    });
};

// Like functionality moved to likeController.js
// Use /api/likes/posts/:postId/toggle endpoint instead
exports.likePost = async (req, res) => {
    res.status(410).json({
        status: 'deprecated',
        message: 'This endpoint is deprecated. Please use /api/likes/posts/:postId/toggle instead'
    });
};

// Deprecated: Comment functionality moved to commentController.js
// Use /api/comments/posts/:postId endpoint instead
exports.addComment = async (req, res) => {
    res.status(410).json({
        status: 'deprecated',
        message: 'This endpoint is deprecated. Please use /api/comments/posts/:postId instead'
    });
};

// Deprecated: Comment functionality moved to commentController.js
// Use /api/comments/posts/:postId endpoint instead
exports.getPostComments = async (req, res) => {
    res.status(410).json({
        status: 'deprecated',
        message: 'This endpoint is deprecated. Please use /api/comments/posts/:postId instead'
    });
};

// Like status check moved to likeController.js
// Use /api/likes/posts/:postId/status endpoint instead
exports.checkLikeStatus = async (req, res) => {
    res.status(410).json({
        status: 'deprecated',
        message: 'This endpoint is deprecated. Please use /api/likes/posts/:postId/status instead'
    });
};

exports.searchPosts = async (req, res) => {
    try {
        const { q, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        if (!q || q.trim() === '') {
            return res.json({
                status: 'success',
                data: {
                    posts: [],
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: 0,
                        totalCount: 0,
                        hasNext: false,
                        hasPrev: false,
                        limit: parseInt(limit)
                    }
                }
            });
        }

        // Create cache key
        const cacheKey = `${CACHE_KEYS.SEARCH_POSTS}_${q.toLowerCase()}_${page}_${limit}`;

        // Try to get from cache first
        const cachedData = await getSearchCache(cacheKey);
        if (cachedData) {
            console.log('Serving search results from cache');
            return res.json({
                status: 'success',
                data: cachedData,
                cached: true
            });
        }

        // Search posts by title or description, only return active posts
        const [posts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: {
                    status: 'active',
                    is_frozen: false,
                    OR: [
                        {
                            title: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        },
                        {
                            description: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        },
                        {
                            content: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        }
                    ]
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
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
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: {
                    status: 'active',
                    is_frozen: false,
                    OR: [
                        {
                            title: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        },
                        {
                            description: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        },
                        {
                            content: {
                                contains: q,
                                mode: 'insensitive'
                            }
                        }
                    ]
                }
            })
        ]);

        // Add full URLs for playback (HLS when ready, else raw)
        const postsWithUrls = posts.map(post => withVideoPlaybackUrl(post));

        const responseData = {
            posts: postsWithUrls,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / limit),
                totalCount,
                hasNext: page * limit < totalCount,
                hasPrev: page > 1,
                limit: parseInt(limit)
            },
            searchQuery: q
        };

        // Cache the response
        await setSearchCache(cacheKey, responseData);

        res.json({
            status: 'success',
            data: responseData,
            cached: false
        });
    } catch (error) {
        console.error('Error searching posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error searching posts',
            data: {
                posts: [],
                pagination: {
                    currentPage: parseInt(req.query.page) || 1,
                    totalPages: 0,
                    totalCount: 0,
                    hasNext: false,
                    hasPrev: false,
                    limit: parseInt(req.query.limit) || 20
                }
            }
        });
    }
};


// Liked posts functionality moved to likeController.js
// Use /api/likes/user/liked endpoint instead
exports.getLikedPosts = async (req, res) => {
    res.status(410).json({
        status: 'deprecated',
        message: 'This endpoint is deprecated. Please use /api/likes/user/liked instead'
    });
};



// Get posts from users that the current user follows (optimized with caching)
exports.getFollowingPosts = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20, sort = 'newest' } = req.query;
        const offset = (page - 1) * limit;

        // Debug logging
        console.log('getFollowingPosts - User ID:', userId, 'Type:', typeof userId);
        console.log('getFollowingPosts - User object:', req.user);

        // Validate userId is a valid UUID
        if (!userId || typeof userId !== 'string') {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid user ID'
            });
        }


        // Additional UUID format validation
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(userId)) {
            console.error('Invalid UUID format:', userId);
            return res.status(400).json({
                status: 'error',
                message: 'Invalid user ID format. Please log in again.',
                details: `Expected UUID format, got: ${userId}`
            });
        }

        // Create cache key
        const cacheKey = `${CACHE_KEYS.FOLLOWING_POSTS}_${userId}_${sort}_${page}_${limit}`;

        // Try to get from cache first
        const cachedData = await getFollowingPostsCache(cacheKey);
        if (cachedData) {
            console.log('Serving following posts from cache');
            return res.json({
                status: 'success',
                data: cachedData,
                cached: true
            });
        }

        // Determine sort order. For feeds we prefer most liked, then newest.
        const orderBy = sort === 'oldest'
            ? { createdAt: 'asc' }
            : [
                { likes: 'desc' },
                { createdAt: 'desc' }
            ];

        // Get posts from users that the current user follows
        console.log('About to query database with userId:', userId);

        // First, get the list of user IDs that the current user follows
        const followingRelations = await prisma.follow.findMany({
            where: {
                followerId: userId
            },
            select: {
                followingId: true
            }
        });

        const followingUserIds = followingRelations.map(rel => rel.followingId);

        console.log(`User ${userId} follows ${followingUserIds.length} users:`, followingUserIds);

        // If user follows no one, return empty result
        if (followingUserIds.length === 0) {
            return res.json({
                status: 'success',
                data: {
                    posts: [],
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: 0,
                        totalCount: 0,
                        hasNext: false,
                        hasPrev: false,
                        limit: parseInt(limit)
                    },
                    filters: {
                        sort,
                        fromFollowing: true
                    }
                },
                cached: false
            });
        }

        const [followingPosts, totalCount] = await Promise.all([
            prisma.post.findMany({
                where: applyFeedReadyFilter({
                    status: 'active',
                    is_frozen: false,
                    user_id: { in: followingUserIds }
                }),
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
                },
                orderBy,
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: {
                    status: 'active',
                    is_frozen: false,
                    user_id: {
                        in: followingUserIds
                    }
                }
            })
        ]);

        // Process posts to add full URLs and optimize response
        const processedPosts = followingPosts.map(post => {
            const p = withVideoPlaybackUrl(post);
            p.isFromFollowing = true;
            return p;
        });

        const responseData = {
            posts: processedPosts,
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
                fromFollowing: true
            }
        };

        // Cache the response
        await setFollowingPostsCache(cacheKey, responseData);

        res.json({
            status: 'success',
            data: responseData,
            cached: false
        });

    } catch (error) {
        console.error('Error fetching following posts:', error);

        // Check if it's a UUID-related error
        if (error.message && error.message.includes('UUID')) {
            console.error('UUID Error Details:', {
                userId: req.user?.id,
                userIdType: typeof req.user?.id,
                error: error.message
            });

            return res.status(400).json({
                status: 'error',
                message: 'Invalid user ID format. Please log in again.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Error fetching posts from users you follow',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get optimized feed with featured and following posts
exports.getOptimizedFeed = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20, includeFeatured = true, includeFollowing = true } = req.query;
        const offset = (page - 1) * limit;

        const feedPosts = [];

        // Get featured posts if requested (only feed-ready posts)
        if (includeFeatured === 'true') {
            const featuredPosts = await prisma.featuredPost.findMany({
                where: {
                    is_active: true,
                    OR: [
                        { expires_at: null },
                        { expires_at: { gt: new Date() } }
                    ],
                    post: applyFeedReadyFilter({})
                },
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
                    }
                },
                orderBy: [
                    { is_featured: 'desc' },
                    { likes: 'desc' },
                    { createdAt: 'desc' }
                ],
                take: Math.floor(parseInt(limit) * 0.3) // 30% featured posts
            });

            featuredPosts.forEach(featured => {
                const p = withVideoPlaybackUrl(featured.post);
                p.isFeatured = true;
                p.featuredAt = featured.createdAt;
                p.expiresAt = featured.expires_at;
                p.featuredBy = featured.admin?.username;
                p.featuredReason = featured.reason;
                feedPosts.push(p);
            });
        }

        // Get following posts if requested
        if (includeFollowing === 'true') {
            const followingPosts = await prisma.post.findMany({
                where: applyFeedReadyFilter({
                    status: 'active',
                    is_frozen: false,
                    user: {
                        followers: {
                            some: { followerId: userId }
                        }
                    }
                }),
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
                },
                orderBy: [
                    { is_featured: 'desc' },
                    { likes: 'desc' },
                    { createdAt: 'desc' }
                ],
                take: Math.floor(parseInt(limit) * 0.7) // 70% following posts
            });

            followingPosts.forEach(post => {
                const p = withVideoPlaybackUrl(post);
                p.isFromFollowing = true;
                feedPosts.push(p);
            });
        }

        // Sort combined feed by creation date
        feedPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Apply pagination to combined results
        const paginatedPosts = feedPosts.slice(offset, offset + parseInt(limit));

        res.json({
            status: 'success',
            data: {
                posts: paginatedPosts,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(feedPosts.length / limit),
                    totalCount: feedPosts.length,
                    hasNext: offset + parseInt(limit) < feedPosts.length,
                    hasPrev: page > 1,
                    limit: parseInt(limit)
                },
                filters: {
                    includeFeatured: includeFeatured === 'true',
                    includeFollowing: includeFollowing === 'true'
                }
            }
        });

    } catch (error) {
        console.error('Error fetching optimized feed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching optimized feed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get user's draft posts
exports.getUserDraftPosts = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const [draftPosts, total] = await Promise.all([
            prisma.post.findMany({
                where: {
                    user_id: userId,
                    status: 'draft'
                },
                include: {
                    category: {
                        select: {
                            id: true,
                            name: true,
                            description: true
                        }
                    },
                    _count: {
                        select: {
                            postLikes: true,
                            comments: true,
                            postViews: true
                        }
                    }
                },
                orderBy: {
                    updatedAt: 'desc'
                },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.post.count({
                where: {
                    user_id: userId,
                    status: 'draft'
                }
            })
        ]);

        // Add full URLs for playback (HLS when ready, else raw)
        const postsWithUrls = draftPosts.map(post => withVideoPlaybackUrl(post));

        res.json({
            status: 'success',
            data: {
                posts: postsWithUrls,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalCount: total,
                    hasNext: page * limit < total,
                    hasPrev: page > 1,
                    limit: parseInt(limit)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching draft posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching draft posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Publish a draft post (change status from draft to active - published immediately)
exports.publishDraftPost = async (req, res) => {
    try {
        const postId = req.params.postId;
        const userId = req.user.id;

        // Check if post exists, belongs to user, and is in draft status
        const existingPost = await prisma.post.findFirst({
            where: {
                id: postId,
                user_id: userId,
                status: 'draft'
            }
        });

        if (!existingPost) {
            return res.status(404).json({
                status: 'error',
                message: 'Draft post not found or you do not have permission to publish it'
            });
        }

        // Update post status to active (published immediately)
        const updatedPost = await prisma.post.update({
            where: { id: postId },
            data: {
                status: 'active',
                updatedAt: new Date()
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                },
                category: {
                    select: {
                        id: true,
                        name: true,
                        description: true
                    }
                }
            }
        });

        // Clear relevant caches
        await clearCacheByPattern('single_post');
        await clearCacheByPattern('all_posts');
        await clearCacheByPattern('following_posts');
        await clearCacheByPattern('featured_posts');
        await clearCacheByPattern('search_posts');
        await clearCacheByPattern('feed:');

        emitEvent('post:published', { postId, userId });

        res.json({
            status: 'success',
            message: 'Draft post published successfully and is now active',
            data: { post: updatedPost }
        });
    } catch (error) {
        console.error('Error publishing draft post:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error publishing draft post',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get video processing status for a post
exports.getVideoProcessingStatus = async (req, res) => {
    try {
        const { postId } = req.params;

        // Validate UUID format
        if (!isUuid(postId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid post ID format'
            });
        }

        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: {
                id: true,
                type: true,
                video_url: true,
                hls_url: true,
                thumbnail_url: true,
                processing_status: true,
                processing_error: true,
                video_duration: true,
                video_width: true,
                video_height: true
            }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        if (post.type !== 'video') {
            return res.json({
                status: 'success',
                data: {
                    postId: post.id,
                    type: post.type,
                    message: 'Not a video post, no HLS processing required'
                }
            });
        }

        const processingStatus = post.processing_status || 'unknown';
        let queueInfo = null;

        if (['pending', 'processing'].includes(processingStatus)) {
            try {
                const [jobStatus, queueStats] = await Promise.all([
                    getJobStatus(post.id),
                    getQueueStats()
                ]);
                const waiting = queueStats.waiting || 0;
                const active = queueStats.active || 0;
                const isActive = jobStatus?.state === 'active';
                const position = isActive ? 1 : (waiting + 1);
                const avgSecondsPerVideo = 45;
                const estimatedSecondsRemaining = isActive
                    ? Math.round(avgSecondsPerVideo * (1 - (jobStatus?.progress || 0) / 100))
                    : (waiting + 1) * avgSecondsPerVideo;

                queueInfo = {
                    positionInQueue: position,
                    jobsWaiting: waiting,
                    jobsActive: active,
                    estimatedSecondsRemaining: Math.max(0, estimatedSecondsRemaining),
                    statusLabel: getProcessingStatusLabel(processingStatus)
                };
            } catch (qErr) {
                queueInfo = { statusLabel: getProcessingStatusLabel(processingStatus), error: 'Queue stats unavailable' };
            }
        }

        res.json({
            status: 'success',
            data: {
                postId: post.id,
                type: post.type,
                processing: {
                    status: processingStatus,
                    statusLabel: getProcessingStatusLabel(processingStatus),
                    error: post.processing_error,
                    hlsReady: post.hls_url && post.processing_status === 'completed',
                    queue: queueInfo
                },
                urls: {
                    raw: post.video_url,
                    hls: post.hls_url,
                    thumbnail: post.thumbnail_url,
                    preferred: (post.hls_url && post.processing_status === 'completed')
                        ? post.hls_url
                        : post.video_url
                },
                metadata: {
                    duration: post.video_duration,
                    width: post.video_width,
                    height: post.video_height
                }
            }
        });
    } catch (error) {
        console.error('Error fetching video processing status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching video processing status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Retry HLS processing for a failed video
exports.retryVideoProcessing = async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.user.id;

        // Validate UUID format
        if (!isUuid(postId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid post ID format'
            });
        }

        // Check if post exists and belongs to user
        const post = await prisma.post.findFirst({
            where: {
                id: postId,
                user_id: userId,
                type: 'video'
            }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Video post not found or you do not have permission'
            });
        }

        // Check if processing already completed
        if (post.processing_status === 'completed' && post.hls_url) {
            return res.json({
                status: 'success',
                message: 'Video already processed successfully',
                data: {
                    hls_url: post.hls_url,
                    thumbnail_url: post.thumbnail_url
                }
            });
        }

        // Check if video_url exists (need raw video to process)
        if (!post.video_url) {
            return res.status(400).json({
                status: 'error',
                message: 'No source video found. Please re-upload the video.'
            });
        }

        // Update processing status to pending
        await prisma.post.update({
            where: { id: postId },
            data: {
                processing_status: 'pending',
                processing_error: null
            }
        });

        // Re-queue for processing (Redis/BullMQ) - video processor server must use same REDIS_URL
        try {
            const queueJob = await addVideoJob(post.id, post.video_url);
            console.log('[POST] Video re-queued for retry', { postId: post.id, jobId: queueJob?.id });
        } catch (queueErr) {
            const errMsg = queueErr?.message || 'Failed to re-queue video';
            console.error('[POST] Retry queue failed', { postId: post.id, error: errMsg });
            await prisma.post.update({
                where: { id: postId },
                data: { processing_status: 'failed', processing_error: errMsg.slice(0, 500) },
            });
            return res.status(503).json({
                status: 'error',
                message: 'Retry failed: processing queue unavailable. Try again later.',
                error: process.env.NODE_ENV === 'development' ? errMsg : undefined,
            });
        }

        res.json({
            status: 'success',
            message: 'Video processing retry initiated. Please allow a few minutes for processing to complete.',
            data: {
                postId: post.id,
                processing_status: 'pending'
            }
        });

    } catch (error) {
        console.error('Error retrying video processing:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error retrying video processing',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/** Track share + bump counters for retention scoring / affinity */
exports.sharePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.user.id;

        if (!isUuid(postId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid post ID format'
            });
        }

        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: { id: true, status: true, is_frozen: true }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        if (post.status !== 'active' || post.is_frozen) {
            return res.status(400).json({
                status: 'error',
                message: 'Post is not available for sharing'
            });
        }

        await prisma.$transaction(async (tx) => {
            await tx.share.create({
                data: {
                    user_id: userId,
                    post_id: postId
                }
            });
            await tx.post.update({
                where: { id: postId },
                data: { shares: { increment: 1 } }
            });
        });

        await affinityService.recordEngagement(userId, postId, 'share');

        await clearCacheByPattern('single_post');
        await clearCacheByPattern('all_posts');
        await clearCacheByPattern('feed:');

        const updated = await prisma.post.findUnique({
            where: { id: postId },
            select: { shares: true }
        });

        res.json({
            status: 'success',
            message: 'Post shared',
            data: { share_count: updated?.shares ?? 0 }
        });
    } catch (error) {
        console.error('[postController.sharePost]', error);
        res.status(500).json({
            status: 'error',
            message: 'Error recording share',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
