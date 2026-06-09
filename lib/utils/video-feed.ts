import { Platform } from 'react-native';

const ANDROID_API_LEVEL = typeof Platform.Version === 'number'
  ? Platform.Version
  : Number.parseInt(String(Platform.Version), 10);
export const IS_OLDER_ANDROID = Platform.OS === 'android' &&
  Number.isFinite(ANDROID_API_LEVEL) &&
  ANDROID_API_LEVEL <= 28;

export const VIDEO_FEED_WINDOW_SIZE = IS_OLDER_ANDROID ? 7 : 9;
export const VIDEO_FEED_INITIAL_NUM_TO_RENDER = IS_OLDER_ANDROID ? 3 : 5;
export const VIDEO_FEED_MAX_TO_RENDER_PER_BATCH = IS_OLDER_ANDROID ? 4 : 6;
export const VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS = false;

/**
 * Modern devices preload one immediate neighbor in each direction.
 * API <= 28 mounts only the active video player; HTTP warmup handles neighbors.
 */
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

  // Mara Z / API <= 28: NEVER mount a second decoder.
  if (IS_OLDER_ANDROID) {
    return false;
  }

  if (index === activeIndex + 1 || index === activeIndex - 1) {
    return true;
  }

  return false;
}

export function getFeedWarmRadius(activeIndex: number, itemCount: number) {
  const forwardSlots = IS_OLDER_ANDROID ? 3 : 2;
  const forward = Math.min(forwardSlots, Math.max(0, itemCount - activeIndex - 1));
  const backward = Math.min(IS_OLDER_ANDROID ? 1 : 1, activeIndex);
  return { forward, backward };
}
