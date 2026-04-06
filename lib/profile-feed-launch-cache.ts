import { Post } from '@/types';
import { primePostDetailsCache } from '@/lib/post-details-cache';
import { warmFeedWindow } from '@/lib/feed-window-warmup';

const PROFILE_FEED_LAUNCH_CACHE_TTL_MS = 2 * 60 * 1000;

type ProfileFeedLaunchEntry = {
  key: string;
  posts: Post[];
  timestamp: number;
};

let profileFeedLaunchEntry: ProfileFeedLaunchEntry | null = null;

function buildKey(userId: string, status?: string) {
  return `${userId}:${status || 'active'}`;
}

export function setProfileFeedLaunchCache(userId: string, status: string | undefined, posts: Post[]) {
  const normalizedPosts = Array.isArray(posts) ? posts : [];
  primePostDetailsCache(normalizedPosts);
  warmFeedWindow(normalizedPosts, 0);

  profileFeedLaunchEntry = {
    key: buildKey(userId, status),
    posts: normalizedPosts,
    timestamp: Date.now(),
  };
}

export function getProfileFeedLaunchCache(userId: string, status?: string): Post[] {
  if (!profileFeedLaunchEntry) {
    return [];
  }

  if (profileFeedLaunchEntry.key !== buildKey(userId, status)) {
    return [];
  }

  if (Date.now() - profileFeedLaunchEntry.timestamp > PROFILE_FEED_LAUNCH_CACHE_TTL_MS) {
    profileFeedLaunchEntry = null;
    return [];
  }

  return profileFeedLaunchEntry.posts;
}
