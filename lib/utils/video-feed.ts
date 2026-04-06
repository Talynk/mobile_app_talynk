export const VIDEO_FEED_WINDOW_SIZE = 5;
export const VIDEO_FEED_INITIAL_NUM_TO_RENDER = 1;
export const VIDEO_FEED_MAX_TO_RENDER_PER_BATCH = 3;
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

  // Only preload the immediate neighbor. Wider HLS preloading made long videos
  // compete for decoder/network/cache resources and destabilized playback.
  const distance = Math.abs(index - activeIndex);
  return distance === 1;
}
