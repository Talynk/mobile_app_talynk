/**
 * Post filtering utilities for HLS-only video display.
 * 
 * All video posts must be HLS-transcoded (.m3u8) before they are shown to users.
 * Image posts always pass through. Draft/processing posts are only shown on the
 * owner's own profile (handled by the caller, not here).
 */

/**
 * Check if a post is HLS-ready (safe to display).
 * 
 * Rules:
 * - Image posts: always pass
 * - Video posts: only pass if the media URL ends with `.m3u8`
 *   OR processing_status is 'completed'
 */
export function isHlsReady(post: any): boolean {
    // Non-video posts always pass
    if (post.type !== 'video') return true;

    // Check hlsReady boolean flag (returned by backend)
    if (post.hlsReady === true) return true;

    // Check if any media URL ends with .m3u8
    const urls = [
        post.fullUrl,
        post.video_url,
        post.videoUrl,
        post.image,
        post.imageUrl,
        post.mediaUrl,
        post.hls_url,
        post.hlsUrl,
    ].filter(Boolean);

    for (const url of urls) {
        if (typeof url === 'string' && url.toLowerCase().includes('.m3u8')) {
            return true;
        }
    }

    // Check processing_status (snake_case from some endpoints) OR processingStatus (camelCase from others)
    if (post.processing_status === 'completed' || post.processingStatus === 'completed') return true;

    // Raw MP4 video — hide from the feed
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
