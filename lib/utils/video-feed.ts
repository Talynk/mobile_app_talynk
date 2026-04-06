export const VIDEO_FEED_WINDOW_SIZE = 7;
export const VIDEO_FEED_INITIAL_NUM_TO_RENDER = 2;
export const VIDEO_FEED_MAX_TO_RENDER_PER_BATCH = 5;
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

  // Preload ±3 items around the active item. These HLS streams are small,
  // and the wider warm window reduces visible loading gaps on fast swipes.
  const distance = Math.abs(index - activeIndex);
  return distance >= 1 && distance <= 3;
}
