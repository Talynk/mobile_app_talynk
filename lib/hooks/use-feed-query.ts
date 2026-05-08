import { useInfiniteQuery } from '@tanstack/react-query';
import { followsApi, postsApi, userApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Post } from '@/types';
import { filterSecondarySurfacePosts } from '@/lib/utils/post-filter';
import { useEffect, useMemo } from 'react';
import { primePostDetailsCache } from '@/lib/post-details-cache';
import { normalizePost } from '@/lib/utils/normalize-post';
import { FEED_DEFAULT_PAGE_SIZE } from '@/lib/feed-config';
import { feedTelemetry } from '@/lib/feed-telemetry';

type FeedTab = 'foryou' | 'following';
type UseFeedQueryOptions = {
  refreshSeed?: number;
  limit?: number;
};

interface FeedPage {
  posts: Post[];
  nextCursor: string | null;
  requestIndex: number;
  endpoint?: 'catalog';
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

async function loadFallbackFollowingFeed(viewerUserId: string, page: number, limit: number): Promise<FeedPage> {
  const followingResponse = await followsApi.getFollowingUsers(viewerUserId, 1, 200);
  const followingUserIds = extractFollowingUsers(followingResponse);

  if (followingUserIds.length === 0) {
    return { posts: [], nextCursor: null, requestIndex: page };
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
  };
}

export function useFeedQuery(tab: FeedTab, options: UseFeedQueryOptions = {}) {
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const userId = isAuthenticated ? user?.id : 'anon';
  const refreshSeed = options.refreshSeed;
  const feedLimit = options.limit ?? FEED_DEFAULT_PAGE_SIZE;

  const queryKey = ['feed', tab, userId, refreshSeed];

  const query = useInfiniteQuery<FeedPage>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      if (__DEV__) {
        console.log(`🔵 [FEED v2-clean] queryFn called: tab=${tab}, pageParam=${pageParam}`);
      }

      if (tab === 'following') {
        if (!isAuthenticated) return { posts: [], nextCursor: null, requestIndex: 1 };
        const page = pageParam ? Number(pageParam) : 1;
        const raw = await postsApi.getFollowing(page, 20);
        const allPosts = extractPosts(raw).map((post) => ({
          ...post,
          is_following_author: true,
        }));
        primePostDetailsCache(allPosts);
        const hlsPosts = sortFeedPostsByLikesThenRecent(filterSecondarySurfacePosts(allPosts));
        if (__DEV__) {
          console.log(`🔵 [FEED v2-clean] following: extracted=${allPosts.length}, afterHLS=${hlsPosts.length}`);
        }
        if (hlsPosts.length === 0) {
          const fallbackFeed = await loadFallbackFollowingFeed(user!.id, page, 20);
          if (__DEV__) {
            console.log(`🔵 [FEED v2-clean] following fallback: posts=${fallbackFeed.posts.length}, next=${fallbackFeed.nextCursor}`);
          }
          return fallbackFeed;
        }
        const pagination = raw?.data?.pagination;
        const hasNext = pagination?.hasNext ?? (allPosts.length >= 20);
        return { posts: hlsPosts, nextCursor: hasNext ? String(page + 1) : null, requestIndex: page };
      }

      // FOR YOU feed: page through the full post catalog so users can keep
      // scrolling through all available HLS-ready videos.
      const requestIndex = pageParam ? Number(pageParam) : 1;
      const limit = feedLimit;
      const raw = await postsApi.getAll(requestIndex, limit, {
        featured_first: 'false',
        status: 'active',
      });

      const rawPosts = Array.isArray(raw?.data?.posts) ? raw.data.posts : [];
      const allPosts: Post[] = rawPosts.map((p: any) => normalizePost(p));
      primePostDetailsCache(allPosts);
      const hlsPosts = sortFeedPostsByLikesThenRecent(filterSecondarySurfacePosts(allPosts));
      const pagination = raw?.data?.pagination || {};
      const totalPages = Number(pagination.totalPages || 0);
      const hasNext = totalPages > 0 ? requestIndex < totalPages : allPosts.length >= limit;

      feedTelemetry.trackFeedRequest({
        endpoint: 'public',
        refresh: refreshSeed,
        fingerprintPresent: !isAuthenticated,
        pipeline: 'catalog-fallback',
        countryPersonalization: null,
        adImpressionsCount: rawPosts.filter((item: any) => item?.is_ad === true || item?.isAd === true).length,
      });

      return {
        posts: hlsPosts,
        nextCursor: hasNext ? String(requestIndex + 1) : null,
        requestIndex,
        endpoint: 'catalog',
      };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (tab === 'following') {
        return lastPage.nextCursor ?? undefined;
      }

      return lastPage.nextCursor ?? undefined;
    },
    placeholderData: (prev: any) => prev, // Keep previous data during key transitions (auth init)
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    retry: 2,
    refetchOnMount: 'always' as const,
  });

  const flattenedPosts = useMemo(
    () => query.data?.pages.flatMap((p) => p.posts) ?? [],
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
      endpoint: isAuthenticated ? 'personalized' : 'public',
      refresh: refreshSeed,
      duplicateRatio: Number.isFinite(duplicateRatio) ? duplicateRatio : 0,
      totalItems: flattenedPosts.length,
      uniqueItems: uniqueIds.size,
    });
  }, [flattenedPosts, isAuthenticated, refreshSeed, tab]);

  return {
    posts,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: !!query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    isError: query.isError,
  };
}
