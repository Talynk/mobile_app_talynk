import { useEffect, useRef, useState, useCallback } from 'react';
import { networkStatus } from '@/lib/network-status';

export function useNetworkStatus() {
  const [status, setStatus] = useState(networkStatus.getStatus());
  const [lastChangedAt, setLastChangedAt] = useState(networkStatus.getLastChangedAt());

  useEffect(() => {
    return networkStatus.subscribe((nextStatus, meta) => {
      setStatus(nextStatus);
      if (meta?.at) setLastChangedAt(meta.at);
    });
  }, []);

  return { status, lastChangedAt, isOffline: status === 'offline' };
}

/**
 * Calls the provided callback automatically when the app transitions from offline to online.
 * Use this in screens that manage their own data fetching (not React Query)
 * so content reloads without the user having to pull-to-refresh.
 */
export function useRefetchOnReconnect(refetchFn: () => void) {
  const wasOffline = useRef(false);
  const stableFn = useCallback(refetchFn, [refetchFn]);

  useEffect(() => {
    const unsubscribe = networkStatus.subscribe((status, meta) => {
      if (meta?.source === 'subscribe') {
        wasOffline.current = status === 'offline';
        return;
      }
      if (status === 'offline') {
        wasOffline.current = true;
      } else if (status === 'online' && wasOffline.current) {
        wasOffline.current = false;
        stableFn();
      }
    });
    return unsubscribe;
  }, [stableFn]);
}

