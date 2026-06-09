import { Platform } from 'react-native';

const ANDROID_API_LEVEL = typeof Platform.Version === 'number'
  ? Platform.Version
  : Number.parseInt(String(Platform.Version), 10);
const IS_OLDER_ANDROID = Platform.OS === 'android' &&
  Number.isFinite(ANDROID_API_LEVEL) &&
  ANDROID_API_LEVEL <= 28;

export const VIDEO_FEED_WINDOW_SIZE = IS_OLDER_ANDROID ? 7 : 9;
export const VIDEO_FEED_INITIAL_NUM_TO_RENDER = IS_OLDER_ANDROID ? 3 : 5;
export const VIDEO_FEED_MAX_TO_RENDER_PER_BATCH = IS_OLDER_ANDROID ? 4 : 6;
export const VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS = false;

/**
 * TikTok-style preload window:
 * - Current post: mount player immediately so first video and resume are instant.
 * - Next post: buffer while user watches current one.
 * - Previous (iOS only): smooth scroll-back.
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

  if (index === activeIndex) {
    return true;
  }

  if (index === activeIndex + 1) {
    return true;
  }

  // iOS can afford one previous neighbor for scroll-back.
  if (Platform.OS === 'ios' && index === activeIndex - 1) {
    return true;
  }

  return false;
}

export function getFeedWarmRadius(activeIndex: number, itemCount: number) {
  const forward = Math.min(1, Math.max(0, itemCount - activeIndex - 1));
  const backward = Platform.OS === 'ios' ? Math.min(1, activeIndex) : 0;
  return { forward, backward };
}
