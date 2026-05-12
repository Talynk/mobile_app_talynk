import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

type ResumeRefreshOptions = {
  enabled?: boolean;
  onSoftResume: (backgroundDurationMs: number) => void | Promise<void>;
  onHardResume: (backgroundDurationMs: number) => void | Promise<void>;
  softResumeAfterMs?: number;
  hardResumeAfterMs?: number;
};

function getDayKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function useResumeRefresh({
  enabled = true,
  onSoftResume,
  onHardResume,
  softResumeAfterMs = 10_000,
  hardResumeAfterMs = 60_000,
}: ResumeRefreshOptions) {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastInactiveAtRef = useRef<number | null>(null);
  const lastInactiveDayRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (previousState === 'active' && nextState !== 'active') {
        const now = Date.now();
        lastInactiveAtRef.current = now;
        lastInactiveDayRef.current = getDayKey(now);
        return;
      }

      if (nextState !== 'active') {
        return;
      }

      const lastInactiveAt = lastInactiveAtRef.current;
      if (!lastInactiveAt) {
        return;
      }

      lastInactiveAtRef.current = null;
      const now = Date.now();
      const backgroundDurationMs = Math.max(0, now - lastInactiveAt);
      const dayChanged = lastInactiveDayRef.current !== getDayKey(now);

      if (dayChanged || backgroundDurationMs >= hardResumeAfterMs) {
        void onHardResume(backgroundDurationMs);
        return;
      }

      if (backgroundDurationMs >= softResumeAfterMs) {
        void onSoftResume(backgroundDurationMs);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [enabled, hardResumeAfterMs, onHardResume, onSoftResume, softResumeAfterMs]);
}
