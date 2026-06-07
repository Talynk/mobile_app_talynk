import { Image as ExpoImage } from 'expo-image';
import { Post } from '@/types';
import { getPlaybackUrl, getPostMediaUrl, getThumbnailUrl } from '@/lib/utils/file-url';
import { primePostDetailsCache, getPostDetailsCached } from '@/lib/post-details-cache';
import { getPostVideoAssetsBatchCached } from '@/lib/post-video-assets-cache';
import { getVideoSource } from '@/lib/utils/video-source';
import { createFeedVideoPlayerKey, prewarmFeedVideoPlayer } from '@/lib/feed-video-player-pool';
import { getFeedWarmRadius } from '@/lib/utils/video-feed';

const FEED_WARM_TTL_MS = 2 * 60 * 1000;

const warmedPostIds = new Map<string, number>();
const releasePrewarmedPlayers = new Map<string, () => void>();

function isVideoPost(post: Post) {
  const mediaUrl = getPostMediaUrl(post) || '';
  return post.type === 'video' || mediaUrl.includes('.m3u8') || mediaUrl.includes('.mp4');
}

function pickThumbnailUrl(post: Post) {
  return getThumbnailUrl(post) || (!isVideoPost(post) ? getPostMediaUrl(post) : null);
}

function getWarmTargets(posts: Post[], centerIndex: number, radius?: { forward: number; backward: number }) {
  if (!Array.isArray(posts) || posts.length === 0) {
    return [];
  }

  const safeCenter = Math.max(0, Math.min(centerIndex, posts.length - 1));
  const warmRadius = radius ?? getFeedWarmRadius(safeCenter, posts.length);
  const start = Math.max(0, safeCenter - warmRadius.backward);
  const end = Math.min(posts.length, safeCenter + warmRadius.forward + 1);
  return posts.slice(start, end).filter((post): post is Post => !!post?.id);
}

export function warmFeedWindow(posts: Post[], centerIndex: number, options?: { radius?: { forward: number; backward: number } }) {
  const targets = getWarmTargets(posts, centerIndex, options?.radius);
  if (targets.length === 0) {
    return;
  }

  primePostDetailsCache(targets);

  const activeTargetIds = new Set(targets.map((post) => post.id));
  for (const [key, release] of [...releasePrewarmedPlayers.entries()]) {
    const separatorIndex = key.indexOf(':');
    const postId = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key;
    if (activeTargetIds.has(postId)) {
      continue;
    }

    release();
    releasePrewarmedPlayers.delete(key);
  }

  targets.forEach((post) => {
    const playbackUrl = getPlaybackUrl(post);
    if (!playbackUrl) {
      return;
    }

    const source = getVideoSource(playbackUrl);
    const sourceKey = createFeedVideoPlayerKey(post.id, source);

    if (releasePrewarmedPlayers.has(sourceKey)) {
      return;
    }

    const release = prewarmFeedVideoPlayer(sourceKey, source);
    releasePrewarmedPlayers.set(sourceKey, release);
  });

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
