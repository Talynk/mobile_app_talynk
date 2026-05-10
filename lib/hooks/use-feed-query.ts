import { useInfiniteQuery } from '@tanstack/react-query';
import { feedApi, followsApi, postsApi, userApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { FeedApiResponse, FeedPagination, Post, UserPreferenceHint } from '@/types';
import { filterHlsReady, filterSecondarySurfacePosts } from '@/lib/utils/post-filter';
import { useEffect, useMemo } from 'react';
import { primePostDetailsCache } from '@/lib/post-details-cache';
import { normalizePost } from '@/lib/utils/normalize-post';
import { FEED_DEFAULT_PAGE_SIZE } from '@/lib/feed-config';
import { feedTelemetry } from '@/lib/feed-telemetry';

type FeedTab = 'foryou' | 'following';
type FeedEndpoint = 'public' | 'personalized' | 'following' | 'catalog';

type UseFeedQueryOptions = {
  refreshSeed?: number;
  limit?: number;
};

type FeedPageParam = {
  page: number;
  cursor?: string | null;
};

interface FeedPage {
  posts: Post[];
  nextCursor: string | null;
  requestIndex: number;
  hasNext: boolean;
  endpoint: FeedEndpoint;
  refresh: number | null;
  pipeline?: string;
  userPreferences: UserPreferenceHint[];
  cached: boolean;
  pagination?: Partial<FeedPagination>;
}

function isSuccessfulFeedResponse(response: FeedApiResponse): response is Extract<FeedApiResponse, { status: 'success' }> {
  return response?.status === 'success' && !!response?.data;
}

function extractPosts(raw: any): Post[] {
  if (Array.isArray(raw?.data?.posts)) return raw.data.posts;
  if (Array.isArray(raw?.data?.data?.posts)) return raw.data.data.posts;
  if (Array.isArray(raw?.posts)) return raw.posts;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function extractFollowingUsers(raw: any): string[] {
  const following = raw?.data?.following;
  if (!Array.isArray(following)) {
    return [];
  }

  return following
    .map((item: any) => item?.following?.id || item?.id || null)
    .filter((id: string | null): id is string => !!id);
}

function extractApprovedPosts(raw: any): Post[] {
  if (Array.isArray(raw?.data?.posts)) return raw.data.posts;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.posts)) return raw.posts;
  return [];
}

function sortFeedPostsByLikesThenRecent(posts: Post[]) {
  return [...posts].sort((a, b) => {
    const aLikes = Number((a as any).likes ?? (a as any).like_count ?? 0);
    const bLikes = Number((b as any).likes ?? (b as any).like_count ?? 0);
    if (bLikes !== aLikes) {
      return bLikes - aLikes;
    }

    const aTime = new Date(a.createdAt || (a as any).created_at || (a as any).uploadDate || 0).getTime();
    const bTime = new Date(b.createdAt || (b as any).created_at || (b as any).uploadDate || 0).getTime();
    return bTime - aTime;
  });
}

function normalizeForYouPosts(rawPosts: any[]) {
  return filterHlsReady(rawPosts.map((post) => normalizePost(post)));
}

function sanitizeUserPreferences(raw: unknown): UserPreferenceHint[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => ({
      category: typeof item?.category === 'string' ? item.category : '',
      score: typeof item?.score === 'number' ? item.score : Number(item?.score ?? 0),
    }))
    .filter((item) => item.category.length > 0 && Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);
}

function countAdPosts(posts: Post[]) {
  return posts.filter((item: any) => item?.is_ad === true || item?.isAd === true).length;
}

function normalizeFeedPage(args: {
  response: Extract<FeedApiResponse, { status: 'success' }>;
  endpoint: 'public' | 'personalized';
  requestIndex: number;
  limit: number;
  refreshSeed?: number;
}): FeedPage {
  const { response, endpoint, requestIndex, limit, refreshSeed } = args;
  const data = response.data ?? {};
  const posts = normalizeForYouPosts(Array.isArray(data.posts) ? data.posts : []);
  const pagination = response.pagination ?? {};
  const nextCursor = typeof data.nextCursor === 'string' && data.nextCursor.length > 0 ? data.nextCursor : null;
  const hasNext =
    typeof pagination.hasNext === 'boolean'
      ? pagination.hasNext
      : nextCursor !== null || posts.length >= limit;
  const userPreferences = sanitizeUserPreferences((data as any).userPreferences);
  const refresh = typeof data.refresh === 'number' ? data.refresh : refreshSeed ?? null;
  const pipeline = typeof data.feed_meta?.pipeline === 'string' ? data.feed_meta.pipeline : undefined;

  primePostDetailsCache(posts);

  feedTelemetry.trackFeedRequest({
    endpoint,
    refresh: refresh ?? undefined,
    fingerprintPresent: endpoint === 'public',
    pipeline,
    countryPersonalization: null,
    adImpressionsCount: countAdPosts(posts),
  });

  if (requestIndex === 1) {
    feedTelemetry.trackPersonalizedFeedLoaded({
      endpoint,
      refresh: refresh ?? undefined,
      preferenceCount: userPreferences.length,
      topCategoryName: userPreferences[0]?.category ?? null,
      postsCount: posts.length,
      adCount: countAdPosts(posts),
      pipeline,
      cached: response.cached === true,
    });
  }

  return {
    posts,
    nextCursor,
    requestIndex,
    hasNext,
    endpoint,
    refresh,
    pipeline,
    userPreferences,
    cached: response.cached === true,
    pagination,
  };
}

async function loadFallbackFollowingFeed(viewerUserId: string, page: number, limit: number): Promise<FeedPage> {
  const followingResponse = await followsApi.getFollowingUsers(viewerUserId, 1, 200);
  const followingUserIds = extractFollowingUsers(followingResponse);

  if (followingUserIds.length === 0) {
    return {
      posts: [],
      nextCursor: null,
      requestIndex: page,
      hasNext: false,
      endpoint: 'following',
      refresh: null,
      userPreferences: [],
      cached: false,
    };
  }

  const approvedResponses = await Promise.all(
    followingUserIds.map((followedUserId) => userApi.getUserApprovedPosts(followedUserId, 1, 50)),
  );

  const merged = new Map<string, Post>();

  approvedResponses.forEach((response) => {
    const approvedPosts = extractApprovedPosts(response)
      .map((post: any) => normalizePost({ ...post, is_following_author: true }))
      .map((post: any) => ({ ...post, is_following_author: true }));

    filterSecondarySurfacePosts(approvedPosts).forEach((post) => {
      if (post?.id && !merged.has(post.id)) {
        merged.set(post.id, post);
      }
    });
  });

  const sortedPosts = sortFeedPostsByLikesThenRecent(Array.from(merged.values()));
  primePostDetailsCache(sortedPosts);

  const start = (page - 1) * limit;
  const pagePosts = sortedPosts.slice(start, start + limit);
  const hasNext = start + limit < sortedPosts.length;

  return {
    posts: pagePosts,
    nextCursor: hasNext ? String(page + 1) : null,
    requestIndex: page,
    hasNext,
    endpoint: 'following',
    refresh: null,
    userPreferences: [],
    cached: false,
  };
}

async function loadForYouFeedPage(args: {
  isAuthenticated: boolean;
  requestIndex: number;
  cursor?: string | null;
  limit: number;
  refreshSeed?: number;
}): Promise<FeedPage> {
  const { isAuthenticated, requestIndex, cursor, limit, refreshSeed } = args;
  const options = {
    cursor: cursor || undefined,
    limit,
    page: requestIndex,
    refresh: refreshSeed,
  };

  let endpoint: 'public' | 'personalized' = isAuthenticated ? 'personalized' : 'public';
  let response: FeedApiResponse;

  try {
    response = isAuthenticated
      ? await feedApi.getPersonalized(options)
      : await feedApi.getPublic(options);
  } catch (error: any) {
    if (isAuthenticated && error?.response?.status === 401) {
      endpoint = 'public';
      response = await feedApi.getPublic(options);
    } else {
      throw error;
    }
  }

  if (!isSuccessfulFeedResponse(response)) {
    throw new Error(response?.message || 'Failed to load feed');
  }

  return normalizeFeedPage({
    response,
    endpoint,
    requestIndex,
    limit,
    refreshSeed,
  });
}

export function useFeedQuery(tab: FeedTab, options: UseFeedQueryOptions = {}) {
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const userId = isAuthenticated ? user?.id : 'guest';
  const refreshSeed = options.refreshSeed;
  const feedLimit = options.limit ?? FEED_DEFAULT_PAGE_SIZE;

  const queryKey = tab === 'foryou'
    ? ['feed', tab, userId, refreshSeed]
    : ['feed', tab, userId];

  const query = useInfiniteQuery<FeedPage>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      if (tab === 'following') {
        if (!isAuthenticated) {
          return {
            posts: [],
            nextCursor: null,
            requestIndex: 1,
            hasNext: false,
            endpoint: 'following',
            refresh: null,
            userPreferences: [],
            cached: false,
          } satisfies FeedPage;
        }

        const currentParam = (pageParam as FeedPageParam | undefined) ?? { page: 1 };
        const page = Number(currentParam.page || 1);
        const raw = await postsApi.getFollowing(page, 20);
        const allPosts = extractPosts(raw).map((post) => ({
          ...post,
          is_following_author: true,
        }));

        primePostDetailsCache(allPosts);

        const filteredPosts = sortFeedPostsByLikesThenRecent(
          filterSecondarySurfacePosts(allPosts.map((post) => normalizePost(post))),
        );
        if (filteredPosts.length === 0) {
          return loadFallbackFollowingFeed(user!.id, page, 20);
        }

        const pagination = raw?.data?.pagination;
        const hasNext = pagination?.hasNext ?? (allPosts.length >= 20);
        return {
          posts: filteredPosts,
          nextCursor: hasNext ? String(page + 1) : null,
          requestIndex: page,
          hasNext,
          endpoint: 'following',
          refresh: null,
          userPreferences: [],
          cached: false,
          pagination,
        };
      }

      const currentParam = (pageParam as FeedPageParam | undefined) ?? { page: 1 };
      return loadForYouFeedPage({
        isAuthenticated,
        requestIndex: Number(currentParam.page || 1),
        cursor: currentParam.cursor,
        limit: feedLimit,
        refreshSeed,
      });
    },
    initialPageParam: { page: 1, cursor: null } as FeedPageParam,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasNext) {
        return undefined;
      }

      return {
        page: lastPage.requestIndex + 1,
        cursor: lastPage.nextCursor,
      } satisfies FeedPageParam;
    },
    placeholderData: (prev: any) => prev,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    retry: 2,
    refetchOnMount: 'always' as const,
  });

  const firstPage = query.data?.pages[0];

  const flattenedPosts = useMemo(
    () => query.data?.pages.flatMap((page) => page.posts) ?? [],
    [query.data],
  );

  const posts = useMemo(() => {
    const seen = new Set<string>();
    return flattenedPosts.filter((post) => {
      if (!post?.id || seen.has(post.id)) {
        return false;
      }
      seen.add(post.id);
      return true;
    });
  }, [flattenedPosts]);

  useEffect(() => {
    if (tab !== 'foryou' || flattenedPosts.length === 0) {
      return;
    }

    const uniqueIds = new Set(flattenedPosts.map((post) => post.id).filter(Boolean));
    const duplicateRatio = 1 - uniqueIds.size / flattenedPosts.length;
    feedTelemetry.trackDuplicateRatio({
      endpoint: firstPage?.endpoint === 'public' ? 'public' : 'personalized',
      refresh: firstPage?.refresh ?? refreshSeed,
      duplicateRatio: Number.isFinite(duplicateRatio) ? duplicateRatio : 0,
      totalItems: flattenedPosts.length,
      uniqueItems: uniqueIds.size,
    });
  }, [firstPage?.endpoint, firstPage?.refresh, flattenedPosts, refreshSeed, tab]);

  return {
    posts,
    userPreferences: firstPage?.userPreferences ?? [],
    effectiveRefresh: firstPage?.refresh ?? refreshSeed ?? null,
    feedPipeline: firstPage?.pipeline,
    feedEndpoint: firstPage?.endpoint === 'following' ? null : firstPage?.endpoint ?? null,
    feedCached: firstPage?.cached ?? false,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: !!query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    isError: query.isError,
  };
}
