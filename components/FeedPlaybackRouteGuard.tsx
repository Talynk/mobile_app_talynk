import { useLayoutEffect } from 'react';
import { usePathname } from 'expo-router';

import { setFeedPlaybackBlocked } from '@/lib/feed-playback-block';
import { isSharedVideoPath } from '@/lib/shared-video-route';

/**
 * Keeps background For You feed muted whenever a shared /v/[id] route is active.
 * Runs at root layout level so it fires before nested tab screens can resume playback.
 */
export function FeedPlaybackRouteGuard() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    const blocked = isSharedVideoPath(pathname);
    setFeedPlaybackBlocked(blocked);
  }, [pathname]);

  return null;
}
