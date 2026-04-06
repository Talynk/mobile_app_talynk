import type { InfiniteData } from '@tanstack/react-query';
import { postsApi } from '@/lib/api';
import { primePostDetailsCache } from '@/lib/post-details-cache';
import { queryClient } from '@/lib/query-client';
import { filterHlsReady } from '@/lib/utils/post-filter';
import { Post } from '@/types';

type FeedPage = {
  posts: Post[];
  nextCursor: string | null;
};

const FOLLOWING_FEED_LIMIT = 20;

function getFollowingFeedQueryKey(viewerUserId: string) {
  return ['feed', 'following', viewerUserId] as const;
}

function extractPosts(raw: any): Post[] {
  if (Array.isArray(raw?.data?.posts)) return raw.data.posts;
  if (Array.isArray(raw?.data?.data?.posts)) return raw.data.data.posts;
  if (Array.isArray(raw?.posts)) return raw.posts;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function mergeFollowingFeedPosts(currentPosts: Post[], incomingPosts: Post[]) {
  const merged = new Map<string, Post>();

  incomingPosts.forEach((post) => {
    if (!post?.id) {
      return;
    }

    merged.set(post.id, post);
  });

  currentPosts.forEach((post) => {
    if (!post?.id || merged.has(post.id)) {
      return;
    }

    merged.set(post.id, post);
  });

  return Array.from(merged.values());
}

function normalizeSeedPosts(posts: Post[], targetUserId: string) {
  return posts
    .filter((post) => post?.id && post.user?.id === targetUserId)
    .map((post) => ({ ...post, is_following_author: true }));
}

function fetchFollowingFeedPage(viewerUserId: string) {
  return async ({ pageParam }: { pageParam: unknown }) => {
    const page = pageParam ? Number(pageParam) : 1;
    const raw = await postsApi.getFollowing(page, FOLLOWING_FEED_LIMIT);
    const allPosts = extractPosts(raw).map((post) => ({
      ...post,
      is_following_author: true,
    }));

    primePostDetailsCache(allPosts);
    const hlsPosts = filterHlsReady(allPosts);
    const pagination = raw?.data?.pagination;
    const hasNext = pagination?.hasNext ?? (allPosts.length >= FOLLOWING_FEED_LIMIT);

    return {
      posts: hlsPosts,
      nextCursor: hasNext ? String(page + 1) : null,
    } satisfies FeedPage;
  };
}

export function seedFollowingFeedCache(viewerUserId: string, targetUserId: string, posts: Post[]) {
  const seedPosts = normalizeSeedPosts(posts, targetUserId);
  if (seedPosts.length === 0) {
    return;
  }

  queryClient.setQueryData<InfiniteData<FeedPage>>(getFollowingFeedQueryKey(viewerUserId), (existing) => {
    const currentPages = existing?.pages ?? [];
    const firstPage = currentPages[0] ?? { posts: [], nextCursor: null };

    return {
      pageParams: existing?.pageParams ?? [undefined],
      pages: [
        {
          ...firstPage,
          posts: mergeFollowingFeedPosts(firstPage.posts, seedPosts),
        },
        ...currentPages.slice(1),
      ],
    };
  });
}

export function removeUserFromFollowingFeedCache(viewerUserId: string, targetUserId: string) {
  queryClient.setQueryData<InfiniteData<FeedPage>>(getFollowingFeedQueryKey(viewerUserId), (existing) => {
    if (!existing?.pages?.length) {
      return existing;
    }

    return {
      ...existing,
      pages: existing.pages.map((page) => ({
        ...page,
        posts: page.posts.filter((post) => post.user?.id !== targetUserId),
      })),
    };
  });
}

export function markUserFollowStateAcrossFeedCaches(targetUserId: string, isFollowing: boolean) {
  queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
    if (!old?.pages) {
      return old;
    }

    return {
      ...old,
      pages: old.pages.map((page: any) => ({
        ...page,
        posts: page.posts.map((post: any) =>
          post.user?.id === targetUserId
            ? { ...post, is_following_author: isFollowing }
            : post,
        ),
      })),
    };
  });
}

export async function prefetchFollowingFeed(viewerUserId: string) {
  await queryClient.fetchInfiniteQuery({
    queryKey: getFollowingFeedQueryKey(viewerUserId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    queryFn: fetchFollowingFeedPage(viewerUserId),
    staleTime: 30_000,
  });
}

export async function syncFollowingFeedAfterFollowChange(options: {
  viewerUserId: string;
  targetUserId: string;
  isFollowing: boolean;
  seedPosts?: Post[];
}) {
  const { viewerUserId, targetUserId, isFollowing, seedPosts = [] } = options;

  markUserFollowStateAcrossFeedCaches(targetUserId, isFollowing);

  if (isFollowing) {
    if (seedPosts.length > 0) {
      seedFollowingFeedCache(viewerUserId, targetUserId, seedPosts);
    }

    await queryClient.invalidateQueries({
      queryKey: getFollowingFeedQueryKey(viewerUserId),
      refetchType: 'none',
    });
    await prefetchFollowingFeed(viewerUserId);
    return;
  }

  removeUserFromFollowingFeedCache(viewerUserId, targetUserId);
  await queryClient.invalidateQueries({ queryKey: getFollowingFeedQueryKey(viewerUserId) });
}
