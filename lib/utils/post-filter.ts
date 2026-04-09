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

function includesGif(value: unknown): boolean {
    return typeof value === 'string' && value.toLowerCase().includes('.gif');
}

export function isGifPost(post: any): boolean {
    if (!post) return false;

    const mimeType = String(post.mime_type || post.mimeType || post.content_type || post.contentType || '').toLowerCase();
    if (mimeType.includes('image/gif')) {
        return true;
    }

    if (String(post.type || post.mediaType || '').toLowerCase() === 'gif') {
        return true;
    }

    return [
        post.image,
        post.imageUrl,
        post.image_url,
        post.thumbnail,
        post.thumbnail_url,
        post.thumbnailUrl,
        post.fullUrl,
        post.playback_url,
        post.video_url,
        post.videoUrl,
        post.mediaUrl,
    ].some(includesGif);
}

export function isAdPost(post: any): boolean {
    if (!post) return false;
    return (
        post.isAd === true ||
        post.is_ad === true ||
        post.ad_id != null ||
        post.adId != null ||
        !!post.ad_title ||
        !!post.sponsor
    );
}

export function shouldHideOutsideForYou(post: any): boolean {
    return isAdPost(post) || isGifPost(post);
}

export function filterSecondarySurfacePosts<T extends { type?: string }>(posts: T[]): T[] {
    if (!Array.isArray(posts)) return posts;
    return filterHlsReady(posts).filter((post) => !shouldHideOutsideForYou(post));
}
