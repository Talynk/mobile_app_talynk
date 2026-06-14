/**
 * Cloudflare Worker for Talentix share links.
 *
 * Deploy on talentix.net (or EXPO_PUBLIC_SHARE_BASE_URL):
 * - GET /.well-known/assetlinks.json  → Android App Links verification
 * - GET /v/:postId                    → Play Store redirect with Install Referrer
 *
 * When the app IS installed, Android opens the App Link directly and this worker
 * is never hit. When the app is NOT installed, the browser lands here and is
 * redirected straight to Play Store — no intermediate page.
 */

const ANDROID_PACKAGE = 'com.ihirwe.talentix';
const PLAY_STORE_BASE = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

// Replace with your Play App Signing SHA-256 fingerprint from Google Play Console.
// Must be uppercase colon-separated, e.g. AB:CD:EF:...
const SHA256_CERT_FINGERPRINTS = [
  'REPLACE_WITH_PLAY_CONSOLE_SHA256_FINGERPRINT',
];

const ASSETLINKS = JSON.stringify([
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: ANDROID_PACKAGE,
      sha256_cert_fingerprints: SHA256_CERT_FINGERPRINTS,
    },
  },
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/.well-known/assetlinks.json') {
      return new Response(ASSETLINKS, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    const match = url.pathname.match(/^\/v\/([^/]+)\/?$/);
    if (match) {
      const postId = decodeURIComponent(match[1]);
      if (!/^[0-9a-f-]{36}$/i.test(postId)) {
        return new Response('Invalid post link', { status: 400 });
      }

      const referrer = encodeURIComponent(`postId=${postId}`);
      const playStoreUrl = `${PLAY_STORE_BASE}&referrer=${referrer}`;
      return Response.redirect(playStoreUrl, 302);
    }

    return new Response('Not found', { status: 404 });
  },
};
