import type { Config } from '@swmansion/react-native-detour';

/** From Detour dashboard → Talentix app → Link settings (keep hash unchanged). */
export const DETOUR_HOST = 'talentix.godetour.link';
export const DETOUR_APP_HASH = 'mIlEGaC9ru';

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
