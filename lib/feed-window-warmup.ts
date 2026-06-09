import { Image as ExpoImage } from 'expo-image';
import { Post } from '@/types';
import { getPlaybackUrl, getPostMediaUrl, getThumbnailUrl } from '@/lib/utils/file-url';
import { primePostDetailsCache, getPostDetailsCached } from '@/lib/post-details-cache';
import { getPostVideoAssetsBatchCached } from '@/lib/post-video-assets-cache';
import { getFeedWarmRadius } from '@/lib/utils/video-feed';

const FEED_WARM_TTL_MS = 2 * 60 * 1000;
const VIDEO_HLS_PREFETCH_INTERVAL_MS = 4_000;

const warmedPostIds = new Map<string, number>();
const videoHlsPrefetchedAt = new Map<string, number>();

function isVideoPost(post: Post) {
  const mediaUrl = getPostMediaUrl(post) || '';
  return post.type === 'video' || mediaUrl.includes('.m3u8') || mediaUrl.includes('.mp4');
}

function pickThumbnailUrl(post: Post) {
  return getThumbnailUrl(post) || (!isVideoPost(post) ? getPostMediaUrl(post) : null);
}

function resolveUrl(base: string, relative: string) {
  if (/^https?:\/\//i.test(relative)) {
    return relative;
  }
  const root = base.slice(0, base.lastIndexOf('/') + 1);
  return `${root}${relative.replace(/^\//, '')}`;
}

async function fetchText(url: string) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`HLS warmup failed: ${response.status}`);
  }
  return response.text();
}

async function prefetchHlsHead(playbackUrl: string, depth = 0): Promise<void> {
  if (depth > 2) {
    return;
  }

  const manifestText = await fetchText(playbackUrl);
  const lines = manifestText.split('\n').map((line) => line.trim()).filter(Boolean);
  const variantUrl = lines.find((line) => !line.startsWith('#') && line.includes('.m3u8'));
  if (variantUrl) {
    await prefetchHlsHead(resolveUrl(playbackUrl, variantUrl), depth + 1);
    return;
  }

  const segmentUrls = lines.filter((line) => !line.startsWith('#'));
  const prefetchTargets = segmentUrls.slice(0, 3);
  await Promise.all(
    prefetchTargets.map((segmentUrl) =>
      fetch(resolveUrl(playbackUrl, segmentUrl), {
        method: 'GET',
        headers: { Range: 'bytes=0-1048575' },
      }).catch(() => undefined),
    ),
  );
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

  // HLS prefetch: always warm forward targets (TTL must not block upcoming videos).
  targets.forEach((post) => {
    const playbackUrl = getPlaybackUrl(post);
    if (!playbackUrl || !playbackUrl.toLowerCase().includes('.m3u8')) {
      return;
    }
    const lastPrefetch = videoHlsPrefetchedAt.get(post.id) || 0;
    if (Date.now() - lastPrefetch < VIDEO_HLS_PREFETCH_INTERVAL_MS) {
      return;
    }
    videoHlsPrefetchedAt.set(post.id, Date.now());
    void prefetchHlsHead(playbackUrl).catch(() => {
      // Best-effort warmup only.
    });
  });

  void getPostDetailsCached(idsNeedingNetwork, { requireNetwork: true }).catch(() => {
    // Best-effort warmup only.
  });
}
