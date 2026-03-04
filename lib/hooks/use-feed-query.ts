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

      // FOR YOU: single call to GET /api/posts/all with large limit
      const page = pageParam ? Number(pageParam) : 1;
      console.log(`🔵 [FEED] ForYou: calling postsApi.getAll(page=${page}, limit=50)`);

      const raw = await postsApi.getAll(page, 50);

      console.log(`🔵 [FEED] ForYou: raw status=${raw?.status}, hasData=${!!raw?.data}`);

      const allPosts = extractPosts(raw);
      console.log(`🔵 [FEED] ForYou: extracted ${allPosts.length} posts from response`);

      allPosts.forEach((p: any, i: number) => {
        console.log(`🔵 [FEED] post[${i}]: id=${p.id?.slice(0,8)} type=${p.type} proc=${p.processing_status} hlsReady=${p.hlsReady} fullUrl=${(p.fullUrl || '').slice(0,50)}`);
      });

      const hlsPosts = filterHlsReady(allPosts);
      console.log(`🔵 [FEED] ForYou: after HLS filter = ${hlsPosts.length} posts`);

      const pagination = raw?.data?.pagination;
      const hasNext = pagination ? (page < pagination.totalPages) : (allPosts.length >= 50);
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
