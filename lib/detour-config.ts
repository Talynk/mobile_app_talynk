import type { Config } from '@swmansion/react-native-detour';

/** From Detour dashboard → Talentix app → Link settings (keep hash unchanged). */
export const DETOUR_HOST = 'talentix.godetour.link';
export const DETOUR_APP_HASH = 'mIlEGaC9ru';

/** Google Play App Signing SHA-256 (not the EAS upload key). Required in Detour dashboard. */
export const ANDROID_PLAY_SIGNING_SHA256 =
  '3A:E9:0E:D7:CB:AD:E4:22:DF:26:EC:23:C9:99:B6:EC:22:C3:47:F8:65:5F:5E:53:1E:70:B3:17:97:0C:12:F7';

export const DETOUR_DEFERRED_LINK_BASE = `https://${DETOUR_HOST}/${DETOUR_APP_HASH}`;

const apiKey = process.env.EXPO_PUBLIC_DETOUR_API_KEY ?? '';
const appID = process.env.EXPO_PUBLIC_DETOUR_APP_ID ?? '';

export const isDetourConfigured = Boolean(apiKey && appID);

export const detourConfig: Config = {
  apiKey,
  appID,
  shouldUseClipboard: true,
  // +native-intent.tsx handles Universal/App links; provider handles deferred installs only.
  linkProcessingMode: 'deferred-only',
};

export const detourNativeIntentConfig = {
  apiKey,
  appID,
  timeoutMs: 2000,
};
