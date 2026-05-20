import { Alert } from 'react-native';
import { Post } from '@/types';

export function getSharedPostLink(_post: Pick<Post, 'id'> | null | undefined): null {
  return null;
}

export function buildPostSharePayload(_post: Post | null | undefined) {
  return {
    title: 'Talentix',
    message: 'Sharing is coming soon.',
    url: null,
  };
}

export async function sharePost(post: Post | null | undefined) {
  const postId = post?.id ? String(post.id) : undefined;
  Alert.alert('Coming soon', 'Sharing Talentix posts is being polished and will be available soon.');
  return {
    action: 'comingSoon',
    postId,
    feedShareRecorded: false,
  };
}
