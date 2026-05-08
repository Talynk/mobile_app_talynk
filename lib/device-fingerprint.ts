import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_FINGERPRINT_KEY = '@talentix_device_fingerprint';

function generateFingerprint() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  return `talentix-${ts}-${rand}`;
}

export async function getDeviceFingerprint(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_FINGERPRINT_KEY);
    if (existing && existing.trim().length > 0) {
      return existing;
    }

    const next = generateFingerprint();
    await AsyncStorage.setItem(DEVICE_FINGERPRINT_KEY, next);
    return next;
  } catch {
    return generateFingerprint();
  }
}

export async function resetDeviceFingerprint(): Promise<string> {
  const next = generateFingerprint();
  try {
    await AsyncStorage.setItem(DEVICE_FINGERPRINT_KEY, next);
  } catch {
    // Best-effort only.
  }
  return next;
}
