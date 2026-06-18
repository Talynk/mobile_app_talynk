import { useEffect } from 'react';
import { useDetourContext } from '@swmansion/react-native-detour';
import { router } from 'expo-router';

import { setFeedPlaybackBlocked } from '@/lib/feed-playback-block';
import { pauseAllVideos } from '@/lib/hooks/use-video-pause-on-blur';

/**
 * Navigates to the matched route after a deferred deep link (post-install first open).
 * Runtime App Links are handled earlier by app/+native-intent.tsx.
 */
export function DetourDeferredLinkHandler() {
  const { link, clearLink } = useDetourContext();

  useEffect(() => {
    if (!link?.pathname) {
      return;
    }

    setFeedPlaybackBlocked(true);
    pauseAllVideos();
    router.replace({
      pathname: link.pathname as any,
      params: link.params,
    });
    clearLink();
  }, [clearLink, link]);

  return null;
}
