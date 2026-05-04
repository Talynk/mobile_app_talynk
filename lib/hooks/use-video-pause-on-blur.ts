/**
 * Global video playback coordinator.
 *
 * Provides:
 * 1. `pauseAllVideos()` — immediately silences every registered player.
 * 2. Registration helpers so individual players can opt-in to global pause.
 * 3. An AppState listener that auto-pauses when the app leaves the foreground.
 * 4. iOS AVAudioSession deactivation to kill ALL audio at the OS level.
 */
import { AppState, AppStateStatus, Platform } from 'react-native';

type PauseCallback = () => void;

const registeredPausers = new Set<PauseCallback>();

/** Register a pause callback. Returns an unregister function. */
export function registerVideoPauser(cb: PauseCallback): () => void {
  registeredPausers.add(cb);
  return () => {
    registeredPausers.delete(cb);
  };
}

/**
 * Deactivate the iOS audio session.
 * This forcefully stops ALL audio output at the OS level — even from orphaned
 * native players that escaped JavaScript cleanup.
 */
function deactivateAudioSessionIOS(): void {
  if (Platform.OS !== 'ios') return;
  try {
    // expo-av's Audio.setAudioModeAsync with staysActiveInBackground:false
    // ensures the audio session is released when no player is active.
    const Audio = require('expo-av').Audio;
    Audio.setAudioModeAsync?.({
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      playsInSilentModeIOS: false, // Kill audio even in silent mode
    }).catch(() => {});
  } catch (_) {
    // expo-av not available — skip gracefully
  }
}

/** Immediately pause ALL registered video players. */
export function pauseAllVideos(): void {
  registeredPausers.forEach((cb) => {
    try {
      cb();
    } catch (_) {}
  });
}

/**
 * Nuclear pause: pause all players AND deactivate iOS audio session.
 * Use when the app is leaving the foreground entirely.
 */
function nuclearPause(): void {
  pauseAllVideos();
  deactivateAudioSessionIOS();
}

// Auto-pause all videos when the app goes to background
let _appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let _blurSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let _memorySubscription: ReturnType<typeof AppState.addEventListener> | null = null;

export function initGlobalVideoPauseListener(): void {
  if (_appStateSubscription) return;

  // 'change' fires when app state transitions (active → background/inactive)
  _appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state !== 'active') {
      nuclearPause();
    }
  });

  // 'blur' fires EARLIER than 'change' — the moment the user touches
  // the home button, swipe-up gesture, or app switcher. This catches
  // the audio before the OS animation even starts.
  try {
    _blurSubscription = AppState.addEventListener('blur' as any, () => {
      nuclearPause();
    });
  } catch (_) {
    // 'blur' event not supported on all RN versions — safe to ignore
  }

  // Memory warnings: iOS may kill cached files (the Sentry crash).
  // Pause all videos to reduce memory pressure.
  try {
    _memorySubscription = AppState.addEventListener('memoryWarning' as any, () => {
      nuclearPause();
    });
  } catch (_) {}
}
