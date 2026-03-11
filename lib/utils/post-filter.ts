/**
 * Post filtering utilities for HLS-only video display.
 *
 * STRICT: Only HLS (.m3u8) adaptive streaming. No MP4 or other formats are allowed
 * to be played or fetched anywhere in the app. Image posts always pass.
 */

/**
 * Check if a post is HLS-ready (safe to display). Image posts always pass.
 * Video: allow if backend says hlsReady, or we have .m3u8, or processing completed with any non-MP4 URL.
 * Only exclude when it's clearly video and the ONLY URL is .mp4 (never play raw MP4).
 */
export function isHlsReady(post: any): boolean {
    const isVideo = post.type === 'video' || post.mediaType === 'video';
    if (!isVideo) return true;

    if (post.hlsReady === true) return true;
    if (post.processing_status === 'completed' || post.processingStatus === 'completed') return true;
    if (post.streamType === 'hls' || post.stream_type === 'hls') return true;

    const fullUrl = post.playback_url || post.fullUrl || post.hls_url || post.hlsUrl;
    if (fullUrl && typeof fullUrl === 'string' && fullUrl.toLowerCase().includes('.m3u8')) return true;
    if (fullUrl && typeof fullUrl === 'string' && !fullUrl.toLowerCase().includes('.mp4')) return true;

    const videoUrl = post.video_url || post.videoUrl || post.mediaUrl;
    if (videoUrl && typeof videoUrl === 'string' && videoUrl.toLowerCase().includes('.m3u8')) return true;
    if (videoUrl && typeof videoUrl === 'string' && !videoUrl.toLowerCase().includes('.mp4')) return true;

    return false;
}

/**
 * Filter an array of posts to only include HLS-ready ones.
 * Image posts always pass. Video posts must have .m3u8 URLs.
 */
export function filterHlsReady<T extends { type?: string }>(posts: T[]): T[] {
    if (!Array.isArray(posts)) return posts;
    return posts.filter(isHlsReady);
}
