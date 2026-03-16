import { postsApi } from '@/lib/api';

const POST_DETAILS_CACHE_TTL_MS = 2 * 60 * 1000;
const POST_DETAILS_CONCURRENCY = 6;

type CachedPostEntry = {
  post: any;
  timestamp: number;
};

type GetPostDetailOptions = {
  requireNetwork?: boolean;
};

const postDetailsCache = new Map<string, CachedPostEntry>();
const inflightPostRequests = new Map<string, Promise<any | null>>();

function isFresh(entry?: CachedPostEntry | null): boolean {
  return !!entry && Date.now() - entry.timestamp < POST_DETAILS_CACHE_TTL_MS;
}

export function primePostDetailsCache(posts: any[]) {
  if (!Array.isArray(posts)) return;

  const timestamp = Date.now();
  posts.forEach((post) => {
    const postId = post?.id;
    if (!postId) return;

    const existing = postDetailsCache.get(postId);
    postDetailsCache.set(postId, {
      post: existing ? { ...existing.post, ...post } : { ...post },
      timestamp,
    });
  });
}

export function getCachedPostDetail(postId: string): any | null {
  const entry = postDetailsCache.get(postId);
  return isFresh(entry) ? entry?.post ?? null : null;
}

export async function getPostDetailCached(
  postId: string,
  options: GetPostDetailOptions = {},
): Promise<any | null> {
  if (!postId) return null;

  if (!options.requireNetwork) {
    const cached = getCachedPostDetail(postId);
    if (cached) {
      return cached;
    }
  }

  const existingRequest = inflightPostRequests.get(postId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const response = await postsApi.getById(postId);
      if (response.status === 'success' && response.data) {
        const mergedPost = {
          ...(postDetailsCache.get(postId)?.post || {}),
          ...response.data,
        };

        postDetailsCache.set(postId, {
          post: mergedPost,
          timestamp: Date.now(),
        });

        return mergedPost;
      }
    } catch (_) {
      // Best-effort cache fallback only.
    }

    return postDetailsCache.get(postId)?.post ?? null;
  })().finally(() => {
    inflightPostRequests.delete(postId);
  });

  inflightPostRequests.set(postId, request);
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

export async function getPostDetailsCached(
  postIds: string[],
  options: GetPostDetailOptions = {},
): Promise<Map<string, any>> {
  const uniqueIds = Array.from(new Set(postIds.filter(Boolean)));
  const entries = await mapWithConcurrency(
    uniqueIds,
    POST_DETAILS_CONCURRENCY,
    async (postId) => [postId, await getPostDetailCached(postId, options)] as const,
  );

  const result = new Map<string, any>();
  entries.forEach(([postId, post]) => {
    if (post) {
      result.set(postId, post);
    }
  });

  return result;
}
