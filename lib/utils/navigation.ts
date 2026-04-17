import { Href, Router } from 'expo-router';
import { pauseAllVideos } from '@/lib/hooks/use-video-pause-on-blur';

type MinimalRouter = Pick<Router, 'back' | 'replace' | 'canGoBack'>;

export function safeRouterBack(router: MinimalRouter, fallbackHref: Href = '/') {
  pauseAllVideos();
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallbackHref);
}
