import { useInfiniteQuery } from '@tanstack/react-query';
import { feedApi, postsApi } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { useAuth } from '@/lib/auth-context';
import { Post } from '@/types';
import { filterHlsReady } from '@/lib/utils/post-filter';
import { useMemo, useEffect } from 'react';

type FeedTab = 'foryou' | 'following';

interface FeedPage {
  posts: Post[];
  nextCursor: string | null;
}

function normalizeFeedResponse(raw: any): FeedPage {
  const data = raw?.data ?? raw;
  const posts: Post[] = Array.isArray(data?.posts) ? data.posts : [];
  const nextCursor: string | null = data?.nextCursor ?? null;
  return { posts: filterHlsReady(posts), nextCursor };
}

function normalizeFollowingResponse(raw: any, page: number, limit: number): FeedPage {
  const data = raw?.data ?? raw;
  const posts: Post[] = Array.isArray(data?.posts) ? data.posts : [];
  const pagination = data?.pagination;
  const hasNext = pagination?.hasNext ?? (posts.length >= limit);
  return {
    posts: filterHlsReady(posts),
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
      if (tab === 'following') {
        if (!isAuthenticated) return { posts: [], nextCursor: null };
        const page = pageParam ? Number(pageParam) : 1;
        const raw = await postsApi.getFollowing(page, 10);
        return normalizeFollowingResponse(raw, page, 10);
      }

      const cursor = pageParam as string | undefined;
      if (isAuthenticated) {
        const raw = await feedApi.getPersonalized(cursor, 10);
        return normalizeFeedResponse(raw);
      }
      const raw = await feedApi.getPublic(cursor, 10);
      return normalizeFeedResponse(raw);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  // Prefetch next page in background once first page loads
  useEffect(() => {
    const pages = query.data?.pages;
    if (!pages || pages.length === 0) return;
    const lastPage = pages[pages.length - 1];
    if (!lastPage.nextCursor) return;

    const nextCursor = lastPage.nextCursor;
    queryClient.prefetchInfiniteQuery({
      queryKey,
      queryFn: async ({ pageParam }) => {
        if (tab === 'following') {
          if (!isAuthenticated) return { posts: [], nextCursor: null };
          const page = pageParam ? Number(pageParam) : 1;
          const raw = await postsApi.getFollowing(page, 10);
          return normalizeFollowingResponse(raw, page, 10);
        }
        const cursor = pageParam as string | undefined;
        if (isAuthenticated) {
          const raw = await feedApi.getPersonalized(cursor, 10);
          return normalizeFeedResponse(raw);
        }
        const raw = await feedApi.getPublic(cursor, 10);
        return normalizeFeedResponse(raw);
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage: FeedPage) => lastPage.nextCursor ?? undefined,
      pages: pages.length + 1,
    });
  }, [query.data?.pages?.length, tab, isAuthenticated, userId]);

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
