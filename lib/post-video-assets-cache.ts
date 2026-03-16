import { postsApi } from '@/lib/api';

const POST_VIDEO_ASSETS_CACHE_TTL_MS = 2 * 60 * 1000;
const POST_VIDEO_ASSETS_CONCURRENCY = 6;

type CachedVideoAssetsEntry = {
  assets: any;
  timestamp: number;
};

const videoAssetsCache = new Map<string, CachedVideoAssetsEntry>();
const inflightVideoAssetsRequests = new Map<string, Promise<any | null>>();

function isFresh(entry?: CachedVideoAssetsEntry | null): boolean {
  return !!entry && Date.now() - entry.timestamp < POST_VIDEO_ASSETS_CACHE_TTL_MS;
}

function normalizeProcessingAssets(postId: string, payload: any) {
  const processing = payload?.processing || {};
  const urls = payload?.urls || {};

  return {
    id: postId,
    processing_status: processing?.status,
    processingStatus: processing?.status,
    hls_url: urls?.hls || '',
    hlsUrl: urls?.hls || '',
    thumbnail_url: urls?.thumbnail || '',
    thumbnailUrl: urls?.thumbnail || '',
    playback_url: urls?.hls || '',
    fullUrl: urls?.preferred || urls?.hls || urls?.raw || '',
    video_url: urls?.raw || '',
    videoUrl: urls?.raw || '',
    hlsReady: !!processing?.hlsReady,
  };
}

export async function getPostVideoAssetsCached(postId: string): Promise<any | null> {
  if (!postId) return null;

  const cached = videoAssetsCache.get(postId);
  if (isFresh(cached)) {
    return cached?.assets ?? null;
  }

  const inflight = inflightVideoAssetsRequests.get(postId);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    try {
      const response = await postsApi.getProcessingStatus(postId);
      if (response.status === 'success' && response.data?.urls) {
        const normalized = normalizeProcessingAssets(postId, response.data);
        videoAssetsCache.set(postId, {
          assets: normalized,
          timestamp: Date.now(),
        });
        return normalized;
      }
    } catch (_) {
      // Best-effort only.
    }

    return videoAssetsCache.get(postId)?.assets ?? null;
  })().finally(() => {
    inflightVideoAssetsRequests.delete(postId);
  });

  inflightVideoAssetsRequests.set(postId, request);
  return request;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function getPostVideoAssetsBatchCached(postIds: string[]): Promise<Map<string, any>> {
  const uniqueIds = Array.from(new Set(postIds.filter(Boolean)));
  const entries = await mapWithConcurrency(
    uniqueIds,
    POST_VIDEO_ASSETS_CONCURRENCY,
    async (postId) => [postId, await getPostVideoAssetsCached(postId)] as const,
  );

  const result = new Map<string, any>();
  entries.forEach(([postId, assets]) => {
    if (assets) {
      result.set(postId, assets);
    }
  });

  return result;
}
