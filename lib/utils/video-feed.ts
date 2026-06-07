import { Platform } from 'react-native';

const ANDROID_API_LEVEL = typeof Platform.Version === 'number'
  ? Platform.Version
  : Number.parseInt(String(Platform.Version), 10);
const IS_OLDER_ANDROID = Platform.OS === 'android' &&
  Number.isFinite(ANDROID_API_LEVEL) &&
  ANDROID_API_LEVEL <= 28;

export const VIDEO_FEED_WINDOW_SIZE = 11;
export const VIDEO_FEED_INITIAL_NUM_TO_RENDER = 7;
export const VIDEO_FEED_MAX_TO_RENDER_PER_BATCH = 8;
export const VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS = false;

export function shouldPreloadFeedVideo(
  index: number,
  activeIndex: number,
  options?: { disabled?: boolean },
): boolean {
  if (options?.disabled) {
    return false;
  }

  if (activeIndex < 0) {
    return false;
  }

  const distance = Math.abs(index - activeIndex);
  if (distance === 0) {
    return false;
  }

  // Immediate neighbors must always buffer first — this is what makes scroll feel instant.
  if (distance === 1) {
    return true;
  }

  const preloadDistance = IS_OLDER_ANDROID ? 2 : 3;
  return distance <= preloadDistance;
}

/** Prefer warming the next item in scroll direction. */
export function getFeedWarmRadius(activeIndex: number, itemCount: number) {
  const forward = Math.min(2, Math.max(0, itemCount - activeIndex - 1));
  const backward = Math.min(1, activeIndex);
  return { forward, backward };
}
