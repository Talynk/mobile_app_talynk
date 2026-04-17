/**
 * Global video playback coordinator.
 *
 * Provides:
 * 1. `pauseAllVideos()` — immediately silences every registered player.
 * 2. Registration helpers so individual players can opt-in to global pause.
 * 3. An AppState listener that auto-pauses when the app leaves the foreground.
 */
import { AppState, AppStateStatus } from 'react-native';

type PauseCallback = () => void;

const registeredPausers = new Set<PauseCallback>();

/** Register a pause callback. Returns an unregister function. */
export function registerVideoPauser(cb: PauseCallback): () => void {
  registeredPausers.add(cb);
  return () => {
    registeredPausers.delete(cb);
  };
}

/** Immediately pause ALL registered video players. */
export function pauseAllVideos(): void {
  registeredPausers.forEach((cb) => {
    try {
      cb();
    } catch (_) {}
  });
}

// Auto-pause all videos when the app goes to background
let _appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

export function initGlobalVideoPauseListener(): void {
  if (_appStateSubscription) return;
  _appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state !== 'active') {
      pauseAllVideos();
    }
  });
}
