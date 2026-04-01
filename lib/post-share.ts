import { Share } from 'react-native';
import { Post } from '@/types';

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
  return Share.share(payload);
}
