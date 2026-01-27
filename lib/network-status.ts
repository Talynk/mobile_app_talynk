type NetworkStatus = 'online' | 'offline';

type Listener = (status: NetworkStatus, meta?: { at: number; source?: string; message?: string }) => void;

let currentStatus: NetworkStatus = 'online';
let lastChangedAt = Date.now();
const listeners = new Set<Listener>();

function notify(meta?: { at: number; source?: string; message?: string }) {
  listeners.forEach((fn) => {
    try {
      fn(currentStatus, meta);
    } catch {
      // ignore listener errors
    }
  });
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
  reportOffline(meta?: { source?: string; message?: string }) {
    if (currentStatus === 'offline') return;
    currentStatus = 'offline';
    lastChangedAt = Date.now();
    notify({ at: lastChangedAt, source: meta?.source, message: meta?.message });
  },
  reportOnline(meta?: { source?: string }) {
    if (currentStatus === 'online') return;
    currentStatus = 'online';
    lastChangedAt = Date.now();
    notify({ at: lastChangedAt, source: meta?.source });
  },
};

