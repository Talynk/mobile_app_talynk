/**
 * Share + deep link configuration.
 * Override via EXPO_PUBLIC_* env at build time.
 */

export const ANDROID_PACKAGE = 'com.ihirwe.talentix';

/** Public HTTPS domain that hosts /.well-known/assetlinks.json and /v/:postId fallback. */
export const SHARE_BASE_URL = (
  process.env.EXPO_PUBLIC_SHARE_BASE_URL || 'https://talentix.net'
).replace(/\/+$/, '');

export const PLAY_STORE_BASE_URL =
  process.env.EXPO_PUBLIC_PLAY_STORE_URL ||
  `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

export const INSTALL_REFERRER_HANDLED_KEY = 'talentix_install_referrer_handled_v1';

export function buildSharedPostUrl(postId: string): string {
  return `${SHARE_BASE_URL}/v/${encodeURIComponent(postId)}`;
}

/** Play Store URL with Install Referrer payload for deferred deep linking after first install. */
export function buildPlayStoreInstallUrl(postId: string): string {
  const referrer = encodeURIComponent(`postId=${postId}`);
  return `${PLAY_STORE_BASE_URL}&referrer=${referrer}`;
}
