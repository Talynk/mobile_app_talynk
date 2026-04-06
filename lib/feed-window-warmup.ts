import { Image as ExpoImage } from 'expo-image';
import { Post } from '@/types';
import { getPostMediaUrl, getThumbnailUrl } from '@/lib/utils/file-url';
import { primePostDetailsCache, getPostDetailsCached } from '@/lib/post-details-cache';
import { getPostVideoAssetsBatchCached } from '@/lib/post-video-assets-cache';

const FEED_WARM_RADIUS = 3;
const FEED_WARM_TTL_MS = 2 * 60 * 1000;

const warmedPostIds = new Map<string, number>();

function isVideoPost(post: Post) {
  const mediaUrl = getPostMediaUrl(post) || '';
  return post.type === 'video' || mediaUrl.includes('.m3u8') || mediaUrl.includes('.mp4');
}

function pickThumbnailUrl(post: Post) {
  return getThumbnailUrl(post) || (!isVideoPost(post) ? getPostMediaUrl(post) : null);
}

function getWarmTargets(posts: Post[], centerIndex: number, radius = FEED_WARM_RADIUS) {
  if (!Array.isArray(posts) || posts.length === 0) {
    return [];
  }

  const safeCenter = Math.max(0, Math.min(centerIndex, posts.length - 1));
  const start = Math.max(0, safeCenter - radius);
  const end = Math.min(posts.length, safeCenter + radius + 1);
  return posts.slice(start, end).filter((post): post is Post => !!post?.id);
}

export function warmFeedWindow(posts: Post[], centerIndex: number, options?: { radius?: number }) {
  const targets = getWarmTargets(posts, centerIndex, options?.radius ?? FEED_WARM_RADIUS);
  if (targets.length === 0) {
    return;
  }

  primePostDetailsCache(targets);

  const freshTargets = targets.filter((post) => {
    const warmedAt = warmedPostIds.get(post.id) || 0;
    if (Date.now() - warmedAt < FEED_WARM_TTL_MS) {
      return false;
    }

    warmedPostIds.set(post.id, Date.now());
    return true;
  });

  if (freshTargets.length === 0) {
    return;
  }

  const thumbnailUrls = freshTargets
    .map((post) => pickThumbnailUrl(post))
    .filter((url): url is string => !!url);

  if (thumbnailUrls.length > 0) {
    void ExpoImage.prefetch(thumbnailUrls, 'memory-disk').catch(() => {
      // Best-effort warmup only.
    });
  }

  const idsNeedingNetwork = freshTargets.map((post) => post.id);
  const videoIds = freshTargets.filter(isVideoPost).map((post) => post.id);

  if (videoIds.length > 0) {
    void getPostVideoAssetsBatchCached(videoIds).catch(() => {
      // Best-effort warmup only.
    });
  }

  void getPostDetailsCached(idsNeedingNetwork, { requireNetwork: true }).catch(() => {
    // Best-effort warmup only.
  });
}
