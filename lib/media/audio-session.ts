import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

let lastMode: 'playback' | 'recording' | 'inactive' | 'shared-playback' | null = null;

async function setMode(
  nextMode: 'playback' | 'recording' | 'inactive' | 'shared-playback',
  config: Parameters<typeof Audio.setAudioModeAsync>[0],
) {
  if (lastMode === nextMode) {
    return;
  }

  try {
    await Audio.setAudioModeAsync(config);
    lastMode = nextMode;
  } catch (_) {
    // Best-effort only. Feed playback must not crash if audio mode update fails.
  }
}

export async function enterPlaybackMode() {
  await setMode('playback', {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground: false,
  });
}

/** Exclusive audio focus for shared deep-link playback (Samsung / OEM-safe). */
export async function enterSharedVideoPlaybackMode() {
  await setMode('shared-playback', {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    shouldDuckAndroid: false,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground: false,
  });
}

export async function enterRecordingMode() {
  await setMode('recording', {
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground: false,
  });
}

export async function deactivateAudio() {
  await setMode('inactive', {
    allowsRecordingIOS: false,
    playsInSilentModeIOS: false,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground: false,
  });
}
