import { createDetourNativeIntentHandler } from '@swmansion/react-native-detour/expo-router';

import { detourNativeIntentConfig, isDetourConfigured } from '@/lib/detour-config';
import { burstPauseFeedVideos, setFeedPlaybackBlocked } from '@/lib/feed-playback-block';
import {
  isSharedVideoPath,
  normalizeSharedVideoRoute,
} from '@/lib/shared-video-route';

const detourRedirectSystemPath = createDetourNativeIntentHandler({
  fallbackPath: '/(tabs)',
  config: isDetourConfigured ? detourNativeIntentConfig : undefined,
});

function blockFeedForSharedRoute(route: string | null | undefined) {
  if (!isSharedVideoPath(route)) {
    return;
  }
  setFeedPlaybackBlocked(true);
  burstPauseFeedVideos();
}

export async function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}) {
  // Local dev uses talentix:// — skip Detour network calls and route directly.
  const localRoute = normalizeSharedVideoRoute(path);
  if (localRoute && !path.includes('godetour.link')) {
    blockFeedForSharedRoute(localRoute);
    return localRoute;
  }

  if (isSharedVideoPath(path)) {
    blockFeedForSharedRoute(path);
  }

  const route = await detourRedirectSystemPath({ path, initial });
  const normalizedRoute = normalizeSharedVideoRoute(route) ?? route;
  blockFeedForSharedRoute(normalizedRoute);
  return normalizedRoute;
}
