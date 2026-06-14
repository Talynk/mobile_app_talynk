import { Alert, Platform, Share } from 'react-native';

import { postsApi } from '@/lib/api';
import { buildSharedPostUrl } from '@/lib/share-config';
import { Post } from '@/types';

function getPostCaption(post: Post | null | undefined): string {
  const caption = post?.caption || post?.description || post?.title || '';
  return String(caption).trim();
}

export function getSharedPostLink(post: Pick<Post, 'id'> | null | undefined): string | null {
  if (!post?.id) return null;
  return buildSharedPostUrl(String(post.id));
}

export function buildPostSharePayload(post: Post | null | undefined) {
  const url = getSharedPostLink(post);
  const caption = getPostCaption(post);
  const message = url
    ? caption
      ? `${caption}\n\n${url}`
      : `Watch this on Talentix\n\n${url}`
    : 'Watch this on Talentix';

  return {
    title: 'Talentix',
    message,
    url,
  };
}

export async function sharePost(post: Post | null | undefined) {
  const postId = post?.id ? String(post.id) : undefined;
  if (!postId) {
    Alert.alert('Unable to share', 'This post is missing an id.');
    return {
      action: 'error',
      postId,
      feedShareRecorded: false,
    };
  }

  const { title, message, url } = buildPostSharePayload(post);
  if (!url) {
    Alert.alert('Unable to share', 'Could not build a share link for this post.');
    return {
      action: 'error',
      postId,
      feedShareRecorded: false,
    };
  }

  try {
    const shareResult = await Share.share(
      Platform.OS === 'ios'
        ? { title, message, url }
        : { title, message },
    );

    if (shareResult.action === Share.dismissedAction) {
      return {
        action: 'dismissed',
        postId,
        feedShareRecorded: false,
      };
    }

    let feedShareRecorded = false;
    try {
      const apiResult = await postsApi.share(postId);
      feedShareRecorded = apiResult.status === 'success';
    } catch (_) {
      // Sharing succeeded even if analytics recording failed.
    }

    return {
      action: 'shared',
      postId,
      feedShareRecorded,
    };
  } catch (error: any) {
    Alert.alert('Share failed', error?.message || 'Unable to open the share sheet right now.');
    return {
      action: 'error',
      postId,
      feedShareRecorded: false,
    };
  }
}
