/** Shared post deep link: /v/{postId} or Detour URL .../mIlEGaC9ru/v/{postId} */
export function isSharedVideoPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return /(?:^|\/)v\/[^/?#]+/.test(path);
}

export function extractSharedPostId(path: string | null | undefined): string | null {
  if (!path) return null;
  const match = path.match(/(?:^|\/)v\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Expo Router path for the shared fullscreen video screen. */
export function buildSharedVideoAppRoute(postId: string): string {
  return `/v/${encodeURIComponent(postId)}`;
}

/** Map Detour/custom-scheme intents to a stable in-app route. */
export function normalizeSharedVideoRoute(path: string): string | null {
  const postId = extractSharedPostId(path);
  return postId ? buildSharedVideoAppRoute(postId) : null;
}
