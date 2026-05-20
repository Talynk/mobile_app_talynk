/**
 * Post filtering utilities for HLS-only video display.
 *
 * STRICT: Only HLS (.m3u8) adaptive streaming. No MP4 or other formats are allowed
 * to be played or fetched anywhere in the app. Image posts always pass.
 */
import { getPlaybackUrl } from './file-url';

/**
 * Check if a post is HLS-ready (safe to display). Image posts always pass.
 * Video: allow only when the canonical playback resolver finds a real HLS URL.
 */
export function isHlsReady(post: any): boolean {
    const isVideo = post.type === 'video' || post.mediaType === 'video';
    if (!isVideo) return true;

    const playbackUrl = getPlaybackUrl(post);
    return typeof playbackUrl === 'string' && playbackUrl.toLowerCase().includes('.m3u8');
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

export function filterChallengeSurfacePosts<T extends { type?: string }>(posts: T[]): T[] {
    if (!Array.isArray(posts)) return posts;
    return posts.filter((post) => !shouldHideOutsideForYou(post));
}
