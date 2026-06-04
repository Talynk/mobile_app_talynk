const prisma = require('../lib/prisma');
const { invalidatePostCaches } = require('../utils/postCacheInvalidation');

/**
 * Internal Video Processing API Controller
 * Used by the remote video processor VPS (talynk-video-processor)
 * 
 * Two integration modes:
 * 1. Redis/BullMQ: Video processor runs Worker, consumes from same queue as backend
 * 2. Polling: Video processor polls GET /pending-videos, processes, calls POST /video-callback
 */

/**
 * Get posts pending video processing (for polling-mode video processor)
 * GET /api/internal/pending-videos
 * 
 * Returns posts with processing_status='pending' and valid video_url.
 * Video processor should poll this endpoint, process each post, then call video-callback.
 */
exports.getPendingVideoPosts = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

        const posts = await prisma.post.findMany({
            where: {
                processing_status: 'pending',
                type: 'video',
                video_url: { not: null }
            },
            select: {
                id: true,
                video_url: true,
                title: true
            },
            orderBy: { uploadDate: 'asc' },
            take: limit
        });

        res.json({
            status: 'success',
            count: posts.length,
            posts: posts.map(p => ({
                id: p.id,
                video_url: p.video_url,
                title: p.title
            }))
        });
    } catch (error) {
        console.error('[InternalAPI] Error fetching pending videos:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch pending videos',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Handle video processing callback
 * POST /api/internal/video-callback
 * 
 * Body:
 * {
 *   postId: string,
 *   status: 'processing' | 'completed' | 'failed',
 *   hlsUrl?: string,
 *   thumbnailUrl?: string,
 *   videoDuration?: number,
 *   videoWidth?: number,
 *   videoHeight?: number,
 *   error?: string
 * }
 */
exports.videoProcessingCallback = async (req, res) => {
    try {
        const { postId, status, hlsUrl, thumbnailUrl, videoDuration, videoWidth, videoHeight, error } = req.body;

        console.log(`[VideoCallback] ${new Date().toISOString()} Received callback`, { postId, status });

        // Validate required fields
        if (!postId || !status) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: postId and status',
            });
        }

        // Validate status value
        if (!['processing', 'completed', 'failed'].includes(status)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid status value. Must be: processing, completed, or failed',
            });
        }

        // Check if post exists
        const post = await prisma.post.findUnique({
            where: { id: postId },
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found',
                postId,
            });
        }

        // Idempotent retries: processor may call completed again after BullMQ retry; avoid redundant writes.
        if (
            status === 'completed' &&
            post.processing_status === 'completed' &&
            post.hls_url
        ) {
            const ts = new Date().toISOString();
            console.log(`[VideoCallback] ${ts} Idempotent: post already completed`, { postId });
            return res.json({
                status: 'success',
                message: 'Already completed (idempotent)',
                postId,
                processingStatus: 'completed',
            });
        }

        // Update post based on status
        const updateData = {
            processing_status: status,
        };

        if (status === 'completed') {
            // Processing completed successfully
            updateData.hls_url = hlsUrl;
            updateData.video_duration = videoDuration;
            updateData.video_width = videoWidth;
            updateData.video_height = videoHeight;
            updateData.processing_error = null;
            if (thumbnailUrl) {
                updateData.thumbnail_url = thumbnailUrl;
            }

            console.log('[VideoCallback] Processing completed', { postId, hlsUrl });
        } else if (status === 'failed') {
            // Processing failed
            updateData.processing_error = error || 'Video processing failed';

            console.error('[VideoCallback] Processing failed', { postId, error });
        } else if (status === 'processing') {
            // Processing started
            console.log('[VideoCallback] Processing started', { postId });
        }

        // Update the post
        await prisma.post.update({
            where: { id: postId },
            data: updateData,
        });

        // Clear caches so processing state changes are reflected immediately.
        try {
            await invalidatePostCaches();
            console.log('[VideoCallback] Caches cleared after video processing status update');
        } catch (cacheErr) {
            console.warn('[VideoCallback] Failed to clear cache:', cacheErr.message);
        }

        res.json({
            status: 'success',
            message: 'Video processing status updated',
            postId,
            processingStatus: status,
        });
    } catch (error) {
        console.error('[VideoCallback] Error handling callback:', error);

        res.status(500).json({
            status: 'error',
            message: 'Error processing callback',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};
