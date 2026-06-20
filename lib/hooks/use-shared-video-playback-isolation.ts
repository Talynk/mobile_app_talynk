import { useCallback, useLayoutEffect } from 'react';
import { useFocusEffect } from 'expo-router';

import { burstPauseFeedVideos } from '@/lib/feed-playback-block';

/**
 * Extra pause bursts while the shared-video screen is focused.
 * Route blocking is handled globally by FeedPlaybackRouteGuard.
 */
export function useSharedVideoPlaybackIsolation() {
  useLayoutEffect(() => {
    burstPauseFeedVideos();
    return () => {
      burstPauseFeedVideos();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      burstPauseFeedVideos();
      return () => {
        burstPauseFeedVideos();
      };
    }, []),
  );
}
