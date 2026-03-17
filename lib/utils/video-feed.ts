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

  // Preload ±2 items around the active item. Since Talynk videos are
  // KB-sized HLS streams (Cloudflare-hosted), this concurrent preload
  // is lightweight and ensures near-instant playback when scrolling.
  const distance = Math.abs(index - activeIndex);
  return distance >= 1 && distance <= 2;
}
