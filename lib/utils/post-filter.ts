/**
 * Post filtering utilities for feed-playable media display.
 *
 * Home/following feeds only show images and backend-provided playable videos.
 * In-progress or failed videos remain profile-only until processing completes.
 */
import { getFileUrl, getPlaybackUrl } from './file-url';

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

function getProcessingStatus(post: any): string {
    return String(post?.processing_status ?? post?.processingStatus ?? '').toLowerCase();
}

function isVideoPost(post: any): boolean {
    const mediaType = String(post?.type || post?.mediaType || '').toLowerCase();
    return (
        mediaType === 'video' ||
        post?.stream_type === 'hls' ||
        post?.streamType === 'hls' ||
        post?.stream_type === 'raw' ||
        post?.streamType === 'raw' ||
        hasString(post?.playback_url) ||
        hasString(post?.video_url) ||
        hasString(post?.videoUrl) ||
        hasString(post?.hls_url) ||
        hasString(post?.hlsUrl)
    );
}

function isImageMedia(post: any): boolean {
    const mediaType = String(post?.type || post?.mediaType || '').toLowerCase();
    return mediaType === 'image' || mediaType === 'photo' || mediaType === 'picture';
}

function hasString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function resolveBackendPlayableUrl(post: any): string | null {
    const rawUrl =
        post?.playback_url ||
        post?.fullUrl ||
        post?.hls_url ||
        post?.hlsUrl ||
        post?.video_url ||
        post?.videoUrl ||
        post?.mediaUrl ||
        post?.media_url ||
        null;

    if (!hasString(rawUrl)) {
        return null;
    }

    return getFileUrl(rawUrl);
}

function hasBackendImageUrl(post: any): boolean {
    return [
        post?.image,
        post?.imageUrl,
        post?.image_url,
        post?.fullUrl,
        post?.mediaUrl,
        post?.media_url,
        post?.thumbnail_url,
        post?.thumbnailUrl,
        post?.thumbnail,
    ].some(hasString);
}

function isAllowedVideoPlayback(post: any, url: string): boolean {
    const lowerUrl = url.toLowerCase();
    const streamType = String(post?.stream_type ?? post?.streamType ?? '').toLowerCase();
    if (lowerUrl.includes('.m3u8') || streamType === 'hls') {
        return true;
    }

    return streamType === 'raw' && hasString(post?.playback_url);
}

/**
 * Check if a post can be displayed in feed surfaces.
 * Images pass. Videos must be completed or have no processing state and expose a
 * backend-provided HLS or explicit raw playback URL. Ads pass only with media.
 */
export function isFeedPlayable(post: any): boolean {
    if (!post) return false;

    if (isAdPost(post)) {
        if (isVideoPost(post)) {
            const adUrl = resolveBackendPlayableUrl(post);
            return !!adUrl && isAllowedVideoPlayback(post, adUrl);
        }
        return hasBackendImageUrl(post) || !!resolveBackendPlayableUrl(post);
    }

    if (isImageMedia(post) || !isVideoPost(post)) {
        return true;
    }

    const status = getProcessingStatus(post);
    if (['uploading', 'pending', 'processing', 'failed'].includes(status)) {
        return false;
    }

    if (status && status !== 'completed') {
        return false;
    }

    const playableUrl = resolveBackendPlayableUrl(post);
    return !!playableUrl && isAllowedVideoPlayback(post, playableUrl);
}

export function filterFeedPlayable<T extends { type?: string }>(posts: T[]): T[] {
    if (!Array.isArray(posts)) return posts;
    return posts.filter(isFeedPlayable);
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
    return filterFeedPlayable(posts).filter((post) => !shouldHideOutsideForYou(post));
}

export function filterChallengeSurfacePosts<T extends { type?: string }>(posts: T[]): T[] {
    if (!Array.isArray(posts)) return posts;
    return posts.filter((post) => !shouldHideOutsideForYou(post));
}
