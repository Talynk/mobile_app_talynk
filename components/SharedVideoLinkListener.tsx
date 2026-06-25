import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';

import { burstPauseFeedVideos, setFeedPlaybackBlocked } from '@/lib/feed-playback-block';
import { enterSharedVideoPlaybackMode } from '@/lib/media/audio-session';
import { normalizeSharedVideoRoute } from '@/lib/shared-video-route';

/**
 * Handles talentix:///v/{id} (and Detour HTTPS) when they arrive after JS is ready.
 * Needed because adb/dev-client intents can land before expo-router is listening.
 */
export function SharedVideoLinkListener() {
  useEffect(() => {
    const navigateToSharedVideo = (url: string) => {
      const route = normalizeSharedVideoRoute(url);
      if (!route) {
        return;
      }

      setFeedPlaybackBlocked(true);
      burstPauseFeedVideos();
      void enterSharedVideoPlaybackMode();
      router.replace(route as any);
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      navigateToSharedVideo(url);
    });

    void Linking.getInitialURL().then((url) => {
      if (url) {
        navigateToSharedVideo(url);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return null;
}
