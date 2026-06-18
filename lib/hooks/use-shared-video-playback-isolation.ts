import { useCallback, useLayoutEffect } from 'react';
import { useFocusEffect } from 'expo-router';

import { setFeedPlaybackBlocked } from '@/lib/feed-playback-block';
import { pauseAllVideos } from '@/lib/hooks/use-video-pause-on-blur';

/**
 * Mutes/pauses background feed players while a shared-video screen is visible.
 */
export function useSharedVideoPlaybackIsolation() {
  useLayoutEffect(() => {
    setFeedPlaybackBlocked(true);
    pauseAllVideos();
    return () => {
      setFeedPlaybackBlocked(false);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFeedPlaybackBlocked(true);
      pauseAllVideos();
      return () => {
        setFeedPlaybackBlocked(false);
        pauseAllVideos();
      };
    }, []),
  );
}
