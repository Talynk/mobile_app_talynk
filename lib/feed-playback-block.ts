import { useEffect, useState } from 'react';

import { pauseAllVideos } from '@/lib/hooks/use-video-pause-on-blur';

/**
 * Blocks For You / tab feed autoplay while overlay routes (e.g. shared /v/[id]) are open.
 * Keeps feed players paused without changing FullscreenFeedPostItem preload logic.
 */
let feedPlaybackBlocked = false;
const listeners = new Set<() => void>();
let pauseBurstTimers: ReturnType<typeof setTimeout>[] = [];

function clearPauseBurstTimers() {
  pauseBurstTimers.forEach((timerId) => clearTimeout(timerId));
  pauseBurstTimers = [];
}

/** Pause every registered feed player several times to win races with async mounts. */
export function burstPauseFeedVideos() {
  pauseAllVideos();
  clearPauseBurstTimers();
  for (const delayMs of [0, 16, 50, 120, 250, 500, 900]) {
    pauseBurstTimers.push(setTimeout(() => pauseAllVideos(), delayMs));
  }
}

function notifyFeedPlaybackBlockListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (_) {}
  });
}

export function setFeedPlaybackBlocked(blocked: boolean) {
  if (feedPlaybackBlocked === blocked) {
    if (blocked) {
      burstPauseFeedVideos();
    }
    return;
  }

  feedPlaybackBlocked = blocked;
  if (blocked) {
    burstPauseFeedVideos();
  } else {
    clearPauseBurstTimers();
  }
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
