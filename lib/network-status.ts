type NetworkStatus = 'online' | 'offline';

type Listener = (status: NetworkStatus, meta?: { at: number; source?: string; message?: string }) => void;

let currentStatus: NetworkStatus = 'online';
let lastChangedAt = Date.now();
const listeners = new Set<Listener>();
const pendingOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>();
const offlineSources = new Map<string, { message?: string }>();
const connectivityFailureCounts = new Map<string, { count: number; lastAt: number }>();
const CONNECTIVITY_FAILURE_WINDOW_MS = 6_000;
const API_CLIENT_FAILURE_THRESHOLD = 2;

function getSourceKey(source?: string): string {
  return source?.trim() || 'unknown';
}

function isConnectivitySource(source?: string): boolean {
  return source === 'api-client' || source === 'offline-probe';
}

function clearPendingTimer(source: string) {
  const timer = pendingOfflineTimers.get(source);
  if (timer) {
    clearTimeout(timer);
    pendingOfflineTimers.delete(source);
  }
}

function clearSources(predicate: (source: string) => boolean) {
  [...pendingOfflineTimers.keys()].forEach((source) => {
    if (predicate(source)) {
      clearPendingTimer(source);
    }
  });

  [...offlineSources.keys()].forEach((source) => {
    if (predicate(source)) {
      offlineSources.delete(source);
    }
  });

  [...connectivityFailureCounts.keys()].forEach((source) => {
    if (predicate(source)) {
      connectivityFailureCounts.delete(source);
    }
  });
}

function notify(meta?: { at: number; source?: string; message?: string }) {
  listeners.forEach((fn) => {
    try {
      fn(currentStatus, meta);
    } catch {
      // ignore listener errors
    }
  });
}

function activateOfflineSource(source: string, message?: string) {
  pendingOfflineTimers.delete(source);
  offlineSources.set(source, { message });

  if (currentStatus !== 'offline') {
    currentStatus = 'offline';
    lastChangedAt = Date.now();
  }

  notify({ at: lastChangedAt, source, message });
}

export const networkStatus = {
  getStatus(): NetworkStatus {
    return currentStatus;
  },
  getLastChangedAt(): number {
    return lastChangedAt;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    // immediately send current state so UI can render consistently
    listener(currentStatus, { at: lastChangedAt, source: 'subscribe' });
    return () => {
      listeners.delete(listener);
    };
  },
  reportOffline(meta?: { source?: string; message?: string; immediate?: boolean }) {
    const source = getSourceKey(meta?.source);

    if (offlineSources.has(source) || pendingOfflineTimers.has(source)) {
      return;
    }

    if (meta?.immediate) {
      activateOfflineSource(source, meta?.message);
      return;
    }

    if (source === 'api-client') {
      const now = Date.now();
      const previous = connectivityFailureCounts.get(source);
      const nextCount =
        previous && now - previous.lastAt <= CONNECTIVITY_FAILURE_WINDOW_MS
          ? previous.count + 1
          : 1;

      connectivityFailureCounts.set(source, { count: nextCount, lastAt: now });

      if (nextCount < API_CLIENT_FAILURE_THRESHOLD) {
        return;
      }

      connectivityFailureCounts.delete(source);
    }

    // Guard against transient request hiccups on otherwise healthy connections.
    const timer = setTimeout(() => {
      activateOfflineSource(source, meta?.message);
    }, 1500);

    pendingOfflineTimers.set(source, timer);
  },
  reportOnline(meta?: { source?: string }) {
    const source = meta?.source ? getSourceKey(meta.source) : null;

    if (!source) {
      clearSources(() => true);
    } else if (isConnectivitySource(source)) {
      clearSources(() => true);
    } else {
      clearPendingTimer(source);
      offlineSources.delete(source);
    }

    if (offlineSources.size > 0 || pendingOfflineTimers.size > 0) {
      return;
    }

    if (currentStatus === 'online') {
      return;
    }

    currentStatus = 'online';
    lastChangedAt = Date.now();
    notify({ at: lastChangedAt, source: source ?? undefined });
  },
};
