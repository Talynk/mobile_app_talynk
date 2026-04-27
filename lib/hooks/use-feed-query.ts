import { useInfiniteQuery } from '@tanstack/react-query';
import { followsApi, postsApi, userApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Post } from '@/types';
import { filterSecondarySurfacePosts } from '@/lib/utils/post-filter';
import { useMemo } from 'react';
import { primePostDetailsCache } from '@/lib/post-details-cache';
import { normalizePost } from '@/lib/utils/normalize-post';

type FeedTab = 'foryou' | 'following';

interface FeedPage {
  posts: Post[];
  nextCursor: string | null;
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
    return { posts: [], nextCursor: null };
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
  };
}

export function useFeedQuery(tab: FeedTab) {
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const userId = isAuthenticated ? user?.id : 'anon';

  const queryKey = ['feed', tab, userId];

  const query = useInfiniteQuery<FeedPage>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      if (__DEV__) {
        console.log(`🔵 [FEED v2-clean] queryFn called: tab=${tab}, pageParam=${pageParam}`);
      }

      if (tab === 'following') {
        if (!isAuthenticated) return { posts: [], nextCursor: null };
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
        return { posts: hlsPosts, nextCursor: hasNext ? String(page + 1) : null };
      }

      // FOR YOU: single call to GET /api/posts/all with large limit
      const page = pageParam ? Number(pageParam) : 1;
      if (__DEV__) {
        console.log(`🔵 [FEED v2-clean] ForYou: calling postsApi.getAll(page=${page}, limit=50)`);
      }

      const raw = await postsApi.getAll(page, 50);

      if (__DEV__) {
        console.log(`🔵 [FEED v2-clean] ForYou: raw status=${raw?.status}, hasData=${!!raw?.data}`);
      }

      const allPosts = extractPosts(raw);
      primePostDetailsCache(allPosts);
      if (__DEV__) {
        console.log(`🔵 [FEED v2-clean] ForYou: extracted ${allPosts.length} posts from response`);
      }

      const hlsPosts = sortFeedPostsByLikesThenRecent(filterSecondarySurfacePosts(allPosts));
      if (__DEV__) {
        console.log(`🔵 [FEED v2-clean] ForYou: after HLS filter = ${hlsPosts.length} posts`);
      }

      const pagination = raw?.data?.pagination || {};
      const hasNext = pagination ? (page < pagination.totalPages) : (allPosts.length >= 50);
      return { posts: hlsPosts, nextCursor: hasNext ? String(page + 1) : null };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: (prev: any) => prev, // Keep previous data during key transitions (auth init)
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    retry: 2,
    refetchOnMount: 'always' as const,
  });

  const posts = useMemo(
    () => query.data?.pages.flatMap((p) => p.posts) ?? [],
    [query.data],
  );

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
