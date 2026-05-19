import type { InfiniteData } from '@tanstack/react-query';
import { followsApi, postsApi } from '@/lib/api';
import { primePostDetailsCache } from '@/lib/post-details-cache';
import { queryClient } from '@/lib/query-client';
import { filterSecondarySurfacePosts } from '@/lib/utils/post-filter';
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

function extractFollowingUsers(raw: any): Set<string> {
  const following = raw?.data?.following;
  if (!Array.isArray(following)) {
    return new Set();
  }

  return new Set(
    following
      .map((item: any) => item?.following?.id || item?.id || null)
      .filter((id: string | null): id is string => !!id),
  );
}

function getPostAuthorId(post: any): string | null {
  return post?.user?.id || post?.user_id || post?.userId || post?.author?.id || null;
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
    .filter((post) => post?.id && (post.user?.id === targetUserId || (post as any).user_id === targetUserId || (post as any).userId === targetUserId))
    .filter((post) => filterSecondarySurfacePosts([post]).length > 0)
    .map((post) => ({ ...post, is_following_author: true }));
}

function fetchFollowingFeedPage(viewerUserId: string) {
  return async ({ pageParam }: { pageParam: unknown }) => {
    const page = pageParam ? Number(pageParam) : 1;
    const followedUserIds = extractFollowingUsers(await followsApi.getFollowingUsers(viewerUserId, 1, 200));
    if (followedUserIds.size === 0) {
      return {
        posts: [],
        nextCursor: null,
      } satisfies FeedPage;
    }

    const raw = await postsApi.getFollowing(page, FOLLOWING_FEED_LIMIT);
    const allPosts = extractPosts(raw)
      .filter((post) => {
        const authorId = getPostAuthorId(post);
        return !!authorId && followedUserIds.has(authorId);
      })
      .map((post) => ({
        ...post,
        is_following_author: true,
      }));

    primePostDetailsCache(allPosts);
    const hlsPosts = filterSecondarySurfacePosts(allPosts);
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

  queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: getFollowingFeedQueryKey(viewerUserId) }, (existing) => {
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
  queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: getFollowingFeedQueryKey(viewerUserId) }, (existing) => {
    if (!existing?.pages?.length) {
      return existing;
    }

    return {
      ...existing,
      pages: existing.pages.map((page) => ({
        ...page,
        posts: page.posts.filter((post: any) => post.user?.id !== targetUserId && post.user_id !== targetUserId && post.userId !== targetUserId),
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
          (post.user?.id === targetUserId || post.user_id === targetUserId || post.userId === targetUserId)
            ? {
                ...post,
                user: post.user ? { ...post.user, id: post.user.id || targetUserId } : post.user,
                user_id: post.user_id || targetUserId,
                userId: post.userId || targetUserId,
                is_following_author: isFollowing,
              }
            : post,
        ),
      })),
    };
  });
}

export function syncFollowStateAcrossFeedCaches(followedUserIds: Set<string>) {
  queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
    if (!old?.pages) {
      return old;
    }

    return {
      ...old,
      pages: old.pages.map((page: any) => ({
        ...page,
        posts: page.posts.map((post: any) =>
          (post.user?.id || post.user_id || post.userId)
            ? {
                ...post,
                is_following_author: followedUserIds.has(post.user?.id || post.user_id || post.userId),
              }
            : post
        ),
      })),
    };
  });
}

export async function prefetchFollowingFeed(viewerUserId: string) {
  await queryClient.fetchInfiniteQuery({
    queryKey: getFollowingFeedQueryKey(viewerUserId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: FeedPage) => lastPage.nextCursor ?? undefined,
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
