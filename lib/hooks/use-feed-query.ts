import { useInfiniteQuery } from '@tanstack/react-query';
import { postsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Post } from '@/types';
import { filterHlsReady } from '@/lib/utils/post-filter';
import { useMemo } from 'react';

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

export function useFeedQuery(tab: FeedTab) {
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const userId = isAuthenticated ? user?.id : 'anon';

  const queryKey = ['feed', tab, userId];

  const query = useInfiniteQuery<FeedPage>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      console.log(`🔵 [FEED] queryFn called: tab=${tab}, pageParam=${pageParam}`);

      if (tab === 'following') {
        if (!isAuthenticated) return { posts: [], nextCursor: null };
        const page = pageParam ? Number(pageParam) : 1;
        const raw = await postsApi.getFollowing(page, 20);
        const allPosts = extractPosts(raw);
        const hlsPosts = filterHlsReady(allPosts);
        console.log(`🔵 [FEED] following: extracted=${allPosts.length}, afterHLS=${hlsPosts.length}`);
        const pagination = raw?.data?.pagination;
        const hasNext = pagination?.hasNext ?? (allPosts.length >= 20);
        return { posts: hlsPosts, nextCursor: hasNext ? String(page + 1) : null };
      }

      // FOR YOU: GET /api/posts/all — featured first, then content + ads interleaved (backend order)
      const page = pageParam ? Number(pageParam) : 1;
      const limit = 20;
      const raw = await postsApi.getAll(page, limit, {
        featured_first: 'true',
        sort: 'default',
        status: 'active',
      });

      const allPosts = extractPosts(raw);
      // Preserve isAd on items; filter to HLS-ready for video posts only (ads and images can stay)
      const hlsPosts = filterHlsReady(allPosts);
      const pagination = raw?.data?.pagination || {};
      const totalPages = pagination.totalPages ?? Math.ceil((pagination.total || 0) / limit) || 1;
      const hasNext = page < totalPages;
      return { posts: hlsPosts, nextCursor: hasNext ? String(page + 1) : null };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
    gcTime: 5 * 60_000,
    retry: 1,
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
