import { Post } from '@/types';
import { primePostDetailsCache } from '@/lib/post-details-cache';
import { warmFeedWindow } from '@/lib/feed-window-warmup';

let explorePostsCache: Post[] = [];

export function setExplorePostsCache(posts: Post[]) {
  explorePostsCache = Array.isArray(posts) ? posts : [];
  primePostDetailsCache(explorePostsCache);
  warmFeedWindow(explorePostsCache, 0);
}

export function getExplorePostsCache(): Post[] {
  return explorePostsCache;
}
