import { Post } from '@/types';

let explorePostsCache: Post[] = [];

export function setExplorePostsCache(posts: Post[]) {
  explorePostsCache = Array.isArray(posts) ? posts : [];
}

export function getExplorePostsCache(): Post[] {
  return explorePostsCache;
}
