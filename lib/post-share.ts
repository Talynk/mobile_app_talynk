import { Share } from 'react-native';
import { Post } from '@/types';
import { postsApi } from '@/lib/api';
import { feedTelemetry } from '@/lib/feed-telemetry';

// Replace these placeholders with your production smart-link domain and store URLs.
export const TALENTIX_SHARE_LINK_BASE_URL =
  process.env.EXPO_PUBLIC_SHARE_LINK_BASE_URL || 'https://links.talentix.net/post';
export const TALENTIX_PLAY_STORE_URL =
  process.env.EXPO_PUBLIC_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=YOUR_PLAY_STORE_PACKAGE';
export const TALENTIX_APP_STORE_URL =
  process.env.EXPO_PUBLIC_APP_STORE_URL || 'https://apps.apple.com/app/idYOUR_APP_STORE_ID';

export function getSharedPostLink(post: Pick<Post, 'id'> | null | undefined): string {
  const postId = post?.id ? encodeURIComponent(String(post.id)) : '';
  return `${TALENTIX_SHARE_LINK_BASE_URL}/${postId}`;
}

export function buildPostSharePayload(post: Post | null | undefined) {
  const shareUrl = getSharedPostLink(post);
  const description = post?.caption || post?.description || post?.title || 'Watch this post on Talentix';
  const message = `${description}\n\n${shareUrl}`;

  return {
    title: 'Talentix',
    message,
    url: shareUrl,
  };
}

export async function sharePost(post: Post | null | undefined) {
  const payload = buildPostSharePayload(post);
  const result = await Share.share(payload);
  const postId = post?.id ? String(post.id) : '';

  // iOS exposes a dismissed action; Android resolves without a reliable dismissal signal.
  const wasDismissed = result.action === Share.dismissedAction;
  if (!postId || wasDismissed) {
    return {
      ...result,
      feedShareRecorded: false,
    };
  }

  const response = await postsApi.share(postId);
  if (response.status === 'success') {
    feedTelemetry.trackShareSuccess({ postId });
  } else {
    feedTelemetry.trackShareFail({
      postId,
      message: response.message || 'share endpoint failed',
    });
  }

  return {
    ...result,
    feedShareRecorded: response.status === 'success',
  };
}
