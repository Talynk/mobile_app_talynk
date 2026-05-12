import { Audio } from 'expo-av';

let lastMode: 'playback' | 'recording' | 'inactive' | null = null;

async function setMode(
  nextMode: 'playback' | 'recording' | 'inactive',
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
