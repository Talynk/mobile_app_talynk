import { Post } from '@/types';

function isLikelyVideoUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const url = value.toLowerCase();
  return (
    url.includes('.m3u8') ||
    url.includes('.mp4') ||
    url.includes('.mov') ||
    url.includes('.webm')
  );
}

function inferPostType(post: any, playbackUrl: string, videoUrl: string, imageUrl: string): 'video' | 'image' {
  if (post?.type === 'video' || post?.mediaType === 'video') return 'video';
  if (post?.type === 'image' || post?.mediaType === 'image') return 'image';
  if (post?.streamType === 'hls' || post?.streamType === 'raw') return 'video';
  if (post?.stream_type === 'hls' || post?.stream_type === 'raw') return 'video';
  if (isLikelyVideoUrl(playbackUrl) || isLikelyVideoUrl(videoUrl)) return 'video';
  if (imageUrl) return 'image';
  return 'image';
}

export function normalizePost(post: any): Post {
  const playbackUrl =
    post?.playback_url ||
    post?.fullUrl ||
    post?.hls_url ||
    post?.hlsUrl ||
    post?.video_url ||
    post?.videoUrl ||
    post?.mediaUrl ||
    '';
  const imageUrl = post?.image || post?.imageUrl || '';
  const videoUrl =
    post?.video_url ||
    post?.videoUrl ||
    ((post?.stream_type === 'raw' || post?.streamType === 'raw') && playbackUrl ? playbackUrl : '') ||
    '';
  const hlsUrl =
    post?.hls_url ||
    post?.hlsUrl ||
    ((post?.stream_type === 'hls' || post?.streamType === 'hls' || playbackUrl?.toLowerCase?.().includes('.m3u8'))
      ? playbackUrl
      : '') ||
    '';
  const type = inferPostType(post, playbackUrl, videoUrl, imageUrl);
  const streamType =
    post?.streamType ||
    post?.stream_type ||
    (hlsUrl ? 'hls' : videoUrl ? 'raw' : null);
  const processingStatus = post?.processingStatus || post?.processing_status || null;
  const hlsReady =
    post?.hlsReady === true ||
    streamType === 'hls' ||
    (!!hlsUrl && processingStatus === 'completed');
  const userFromPost = post?.user;
  const authorName = post?.authorName || post?.user_name || post?.username || userFromPost?.username;
  const authorProfilePicture =
    post?.authorProfilePicture ||
    post?.user_avatar ||
    post?.profile_picture ||
    userFromPost?.profile_picture ||
    null;

  return {
    ...post,
    type,
    mediaType: post?.mediaType || type,
    image: imageUrl || post?.image || '',
    imageUrl: post?.imageUrl || imageUrl || '',
    video_url: videoUrl,
    videoUrl: post?.videoUrl || videoUrl,
    hls_url: hlsUrl,
    hlsUrl: post?.hlsUrl || hlsUrl,
    playback_url: post?.playback_url || playbackUrl || hlsUrl || '',
    fullUrl: playbackUrl || hlsUrl || videoUrl || imageUrl || '',
    streamType,
    stream_type: post?.stream_type || streamType || undefined,
    hlsReady,
    processing_status: post?.processing_status || processingStatus || undefined,
    processingStatus,
    thumbnail_url: post?.thumbnail_url || post?.thumbnailUrl || post?.thumbnail || '',
    thumbnailUrl: post?.thumbnailUrl || post?.thumbnail_url || post?.thumbnail || '',
    thumbnail: post?.thumbnail || post?.thumbnail_url || post?.thumbnailUrl || '',
    createdAt: post?.createdAt || post?.created_at || post?.uploadDate || new Date(0).toISOString(),
    updatedAt: post?.updatedAt || post?.updated_at || post?.createdAt || post?.created_at || new Date(0).toISOString(),
    likes: post?.likes ?? post?.like_count ?? post?.likesCount ?? 0,
    likesCount: post?.likesCount ?? post?.likes ?? post?.like_count ?? 0,
    like_count: post?.like_count ?? post?.likes ?? post?.likesCount ?? 0,
    comments_count: post?.comments_count ?? post?.commentsCount ?? post?.comment_count ?? 0,
    commentsCount: post?.commentsCount ?? post?.comments_count ?? post?.comment_count ?? 0,
    comment_count: post?.comment_count ?? post?.comments_count ?? post?.commentsCount ?? 0,
    views: post?.views ?? post?.view_count ?? 0,
    view_count: post?.view_count ?? post?.views ?? 0,
    is_featured: post?.is_featured ?? post?.isFeatured ?? false,
    isAd: !!post?.isAd,
    user:
      userFromPost ||
      (post?.user_id || authorName || authorProfilePicture
        ? {
            id: post?.user_id || post?.userId || '',
            username: authorName || '',
            profile_picture: authorProfilePicture,
          }
        : undefined),
  };
}

export function normalizePosts(posts: any[]): Post[] {
  if (!Array.isArray(posts)) return [];
  return posts.map(normalizePost);
}
