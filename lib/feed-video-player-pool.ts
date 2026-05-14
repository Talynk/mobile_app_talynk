import { Platform } from 'react-native';
import { createVideoPlayer, type VideoPlayer, type VideoSource } from 'expo-video';

type PoolEntry = {
  key: string;
  player: VideoPlayer;
  sourceSignature: string;
  lastUsedAt: number;
  detachedAt: number | null;
  activeRefs: number;
  warmRefs: number;
};

type PlayerLease = {
  player: VideoPlayer;
  release: () => void;
};

const MAX_POOL_SIZE = Platform.OS === 'ios' ? 8 : 6;
const IDLE_EVICT_AFTER_MS = 45_000;
const RELEASE_GRACE_MS = Platform.OS === 'ios' ? 8_000 : 3_000;
const playerPool = new Map<string, PoolEntry>();

function getSourceSignature(source: VideoSource) {
  if (typeof source === 'string' || typeof source === 'number') {
    return String(source);
  }

  if (!source || typeof source !== 'object') {
    return 'null';
  }

  return [
    source.uri ?? '',
    source.assetId ?? '',
    source.contentType ?? 'auto',
    source.useCaching === true ? 'cache' : 'nocache',
  ].join(':');
}

export function createFeedVideoPlayerKey(postId: string, source: VideoSource) {
  return `${postId}:${getSourceSignature(source)}`;
}

function configureFeedPlayer(player: VideoPlayer) {
  try {
    player.loop = true;
    player.muted = true;
    player.staysActiveInBackground = false;
    player.timeUpdateEventInterval = 0.25;

    try {
      (player as any).audioMixingMode = 'doNotMix';
    } catch {
      // Best-effort only.
    }

    if (Platform.OS === 'android') {
      try {
        player.bufferOptions = {
          preferredForwardBufferDuration: 8,
          minBufferForPlayback: 1,
          maxBufferBytes: 0,
          prioritizeTimeOverSizeThreshold: true,
        } as any;
      } catch {
        (player as any).preferredForwardBufferDuration = 8;
      }
    } else {
      try {
        player.bufferOptions = {
          preferredForwardBufferDuration: 0,
          waitsToMinimizeStalling: false,
        } as any;
      } catch {
        (player as any).preferredForwardBufferDuration = 0;
      }
    }

    player.pause();
  } catch {
    // Best-effort only.
  }
}

function releaseEntry(entry: PoolEntry) {
  try {
    entry.player.muted = true;
    entry.player.pause();
  } catch {
    // Best-effort only.
  }

  try {
    entry.player.release();
  } catch {
    // Best-effort only.
  }

  playerPool.delete(entry.key);
}

function evictIdleEntries() {
  const now = Date.now();
  const idleEntries = [...playerPool.values()]
    .filter((entry) => (
      entry.activeRefs === 0 &&
      entry.warmRefs === 0 &&
      entry.detachedAt !== null &&
      now - entry.detachedAt >= RELEASE_GRACE_MS
    ))
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

  idleEntries.forEach((entry) => {
    if (now - entry.lastUsedAt > IDLE_EVICT_AFTER_MS) {
      releaseEntry(entry);
    }
  });

  if (playerPool.size <= MAX_POOL_SIZE) {
    return;
  }

  const remainingIdle = [...playerPool.values()]
    .filter((entry) => (
      entry.activeRefs === 0 &&
      entry.warmRefs === 0 &&
      entry.detachedAt !== null &&
      now - entry.detachedAt >= RELEASE_GRACE_MS
    ))
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

  while (playerPool.size > MAX_POOL_SIZE && remainingIdle.length > 0) {
    const entry = remainingIdle.shift();
    if (!entry) {
      break;
    }

    if (playerPool.has(entry.key)) {
      releaseEntry(entry);
    }
  }
}

function getOrCreateEntry(key: string, source: VideoSource) {
  const sourceSignature = getSourceSignature(source);
  const existing = playerPool.get(key);

  if (existing) {
    existing.lastUsedAt = Date.now();

    if (existing.sourceSignature !== sourceSignature) {
      try {
        existing.player.replace(source, true);
        configureFeedPlayer(existing.player);
        existing.sourceSignature = sourceSignature;
      } catch {
        releaseEntry(existing);
        return getOrCreateEntry(key, source);
      }
    }

    return existing;
  }

  const player = createVideoPlayer(source);
  configureFeedPlayer(player);

  const entry: PoolEntry = {
    key,
    player,
    sourceSignature,
    lastUsedAt: Date.now(),
    detachedAt: null,
    activeRefs: 0,
    warmRefs: 0,
  };

  playerPool.set(key, entry);
  evictIdleEntries();
  return entry;
}

export function acquireFeedVideoPlayer(key: string, source: VideoSource): PlayerLease {
  const entry = getOrCreateEntry(key, source);
  entry.activeRefs += 1;
  entry.lastUsedAt = Date.now();
  entry.detachedAt = null;

  return {
    player: entry.player,
    release: () => {
      const current = playerPool.get(key);
      if (!current) {
        return;
      }

      current.activeRefs = Math.max(0, current.activeRefs - 1);
      current.lastUsedAt = Date.now();
      if (current.activeRefs === 0 && current.warmRefs === 0) {
        current.detachedAt = Date.now();
        try {
          current.player.muted = true;
          current.player.pause();
        } catch {
          // Best-effort only.
        }
        setTimeout(evictIdleEntries, RELEASE_GRACE_MS);
      }
    },
  };
}

export function prewarmFeedVideoPlayer(key: string, source: VideoSource): () => void {
  const entry = getOrCreateEntry(key, source);
  entry.warmRefs += 1;
  entry.lastUsedAt = Date.now();
  entry.detachedAt = null;

  try {
    entry.player.muted = true;
    entry.player.pause();
  } catch {
    // Best-effort only.
  }

  return () => {
    const current = playerPool.get(key);
    if (!current) {
      return;
    }

    current.warmRefs = Math.max(0, current.warmRefs - 1);
    current.lastUsedAt = Date.now();
    if (current.activeRefs === 0 && current.warmRefs === 0) {
      current.detachedAt = Date.now();
      setTimeout(evictIdleEntries, RELEASE_GRACE_MS);
    }
  };
}
