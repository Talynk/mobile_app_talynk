/**
 * Post filtering utilities for HLS-only video display.
 *
 * STRICT: Only HLS (.m3u8) adaptive streaming. No MP4 or other formats are allowed
 * to be played or fetched anywhere in the app. Image posts always pass.
 */

/**
 * Check if a post is HLS-ready (safe to display).
 * STRICT: Only HLS (.m3u8) or backend-confirmed completed. No MP4, no other formats.
 */
export function isHlsReady(post: any): boolean {
    // Non-video posts always pass
    if (post.type !== 'video') return true;

    // Backend says HLS is ready
    if (post.hlsReady === true) return true;

    const urls = [
        post.fullUrl,
        post.video_url,
        post.videoUrl,
        post.mediaUrl,
        post.hls_url,
        post.hlsUrl,
    ].filter(Boolean);

    for (const url of urls) {
        if (typeof url === 'string' && url.toLowerCase().includes('.m3u8')) return true;
    }

    // Processing completed (backend transcoded to HLS)
    if (post.processing_status === 'completed' || post.processingStatus === 'completed') return true;

    // No HLS — do not show (no MP4, no other formats)
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
