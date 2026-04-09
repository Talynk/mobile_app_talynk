import { Href, Router } from 'expo-router';

type MinimalRouter = Pick<Router, 'back' | 'replace' | 'canGoBack'>;

export function safeRouterBack(router: MinimalRouter, fallbackHref: Href = '/') {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallbackHref);
}
