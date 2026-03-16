import { Post } from '@/types';

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
  profileFeedLaunchEntry = {
    key: buildKey(userId, status),
    posts: Array.isArray(posts) ? posts : [],
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
