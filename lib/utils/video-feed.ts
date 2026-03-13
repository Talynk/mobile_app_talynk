export const VIDEO_FEED_WINDOW_SIZE = 3;
export const VIDEO_FEED_INITIAL_NUM_TO_RENDER = 1;
export const VIDEO_FEED_MAX_TO_RENDER_PER_BATCH = 2;
export const VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS = false;

export function shouldPreloadFeedVideo(
  index: number,
  activeIndex: number,
  options?: { disabled?: boolean }
): boolean {
  if (options?.disabled) {
    return false;
  }

  if (activeIndex < 0) {
    return false;
  }

  // Keep only the immediate next item warm. Loading previous + next was
  // starting too many HLS streams at once and causing stalls during scroll.
  return index - activeIndex === 1;
}
