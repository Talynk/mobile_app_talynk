import { useEffect, useState } from 'react';

/**
 * Blocks For You / tab feed autoplay while overlay routes (e.g. shared /v/[id]) are open.
 * Keeps feed players paused without changing FullscreenFeedPostItem preload logic.
 */
let feedPlaybackBlocked = false;
const listeners = new Set<() => void>();

function notifyFeedPlaybackBlockListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (_) {}
  });
}

export function setFeedPlaybackBlocked(blocked: boolean) {
  if (feedPlaybackBlocked === blocked) {
    return;
  }
  feedPlaybackBlocked = blocked;
  notifyFeedPlaybackBlockListeners();
}

export function isFeedPlaybackBlocked() {
  return feedPlaybackBlocked;
}

export function subscribeFeedPlaybackBlocked(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFeedPlaybackBlocked() {
  const [blocked, setBlocked] = useState(isFeedPlaybackBlocked());

  useEffect(() => subscribeFeedPlaybackBlocked(() => {
    setBlocked(isFeedPlaybackBlocked());
  }), []);

  return blocked;
}
