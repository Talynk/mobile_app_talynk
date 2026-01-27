import { useEffect, useState } from 'react';
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

