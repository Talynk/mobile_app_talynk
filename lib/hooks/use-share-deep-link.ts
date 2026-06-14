import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { router, usePathname } from 'expo-router';

import { buildSharedPostRoute, extractSharedPostIdFromUrl } from '@/lib/deep-linking/share-links';
import { consumeDeferredSharePostId } from '@/lib/deep-linking/install-referrer';

type Options = {
  enabled: boolean;
};

function navigateToSharedPost(postId: string, replace = false) {
  const route = buildSharedPostRoute(postId);
  if (replace) {
    router.replace(route as any);
    return;
  }
  router.push(route as any);
}

/**
 * Handles:
 * - Android App Links → /v/:postId (also picked up by Expo Router when cold-started)
 * - Custom scheme links while the app is running
 * - Play Install Referrer deferred deep links after first install from Play Store
 */
export function useShareDeepLink({ enabled }: Options) {
  const pathname = usePathname();
  const handledInitialRef = useRef(false);
  const handledDeferredRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;

    const handleUrl = (url: string | null, replace = false) => {
      const postId = extractSharedPostIdFromUrl(url);
      if (!postId || disposed) return false;

      const targetRoute = buildSharedPostRoute(postId);
      if (pathname === targetRoute || pathname.startsWith(`${targetRoute}?`)) {
        return true;
      }

      navigateToSharedPost(postId, replace);
      return true;
    };

    const bootstrap = async () => {
      if (handledInitialRef.current) return;
      handledInitialRef.current = true;

      try {
        const initialUrl = await Linking.getInitialURL();
        if (handleUrl(initialUrl, false)) {
          return;
        }
      } catch (_) {}

      if (Platform.OS !== 'android' || handledDeferredRef.current || disposed) {
        return;
      }

      handledDeferredRef.current = true;
      const deferredPostId = await consumeDeferredSharePostId();
      if (deferredPostId && !disposed) {
        navigateToSharedPost(deferredPostId, true);
      }
    };

    void bootstrap();

    const subscription = Linking.addEventListener('url', (event) => {
      handleUrl(event.url, false);
    });

    return () => {
      disposed = true;
      subscription.remove();
    };
  }, [enabled, pathname]);
}
