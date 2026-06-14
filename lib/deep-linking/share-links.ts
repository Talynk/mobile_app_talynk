import * as Linking from 'expo-linking';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePostId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = decodeURIComponent(String(value)).trim();
  if (!trimmed || !UUID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/** Extract a post id from https://talentix.net/v/:id, talentix://v/:id, or query ?postId=. */
export function extractSharedPostIdFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;

  try {
    const parsed = Linking.parse(rawUrl);
    const path = String(parsed.path || '').replace(/^\/+/, '');

    if (path.startsWith('v/')) {
      const fromPath = normalizePostId(path.slice(2).split('/')[0]);
      if (fromPath) return fromPath;
    }

    if (path.startsWith('post/')) {
      const fromPostPath = normalizePostId(path.slice(5).split('/')[0]);
      if (fromPostPath) return fromPostPath;
    }

    const queryPostId =
      normalizePostId(typeof parsed.queryParams?.postId === 'string' ? parsed.queryParams.postId : null) ||
      normalizePostId(typeof parsed.queryParams?.id === 'string' ? parsed.queryParams.id : null);
    if (queryPostId) return queryPostId;

    const hostname = String(parsed.hostname || '').toLowerCase();
    if (hostname === 'v') {
      const fromHostPath = normalizePostId(path.split('/')[0]);
      if (fromHostPath) return fromHostPath;
    }
  } catch (_) {
    // fall through to regex
  }

  const match = String(rawUrl).match(/\/(?:v|post)\/([0-9a-f-]{36})/i);
  return match ? normalizePostId(match[1]) : null;
}

export function buildSharedPostRoute(postId: string): `/v/${string}` {
  return `/v/${postId}`;
}
