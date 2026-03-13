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

function isLikelyImageUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const url = value.toLowerCase();
  return (
    url.includes('.jpg') ||
    url.includes('.jpeg') ||
    url.includes('.png') ||
    url.includes('.webp') ||
    url.includes('.gif') ||
    url.includes('.bmp') ||
    url.includes('.heic') ||
    url.includes('.heif') ||
    url.includes('.avif') ||
    url.includes('.svg')
  );
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return '';
}

function getChallengeEntries(post: any): any[] {
  return [
    ...(Array.isArray(post?.challengePosts) ? post.challengePosts : []),
    ...(Array.isArray(post?.challenge_posts) ? post.challenge_posts : []),
    ...(post?.challengePost ? [post.challengePost] : []),
    ...(post?.challenge_post ? [post.challenge_post] : []),
  ].filter(Boolean);
}

function inferPostType(post: any, playbackUrl: string, videoUrl: string, imageUrl: string): 'video' | 'image' {
  const explicitImage = post?.type === 'image' || post?.mediaType === 'image';
  const explicitVideo = post?.type === 'video' || post?.mediaType === 'video';
  const likelyVideo =
    post?.streamType === 'hls' ||
    post?.streamType === 'raw' ||
    post?.stream_type === 'hls' ||
    post?.stream_type === 'raw' ||
    isLikelyVideoUrl(playbackUrl) ||
    isLikelyVideoUrl(videoUrl);
  const likelyImage = !!imageUrl || isLikelyImageUrl(playbackUrl) || isLikelyImageUrl(videoUrl);

  if (explicitImage) return 'image';
  if (explicitVideo && likelyImage && !likelyVideo) return 'image';
  if (explicitVideo) return 'video';
  if (post?.streamType === 'hls' || post?.streamType === 'raw') return 'video';
  if (post?.stream_type === 'hls' || post?.stream_type === 'raw') return 'video';
  if (isLikelyVideoUrl(playbackUrl) || isLikelyVideoUrl(videoUrl)) return 'video';
  if (imageUrl) return 'image';
  return 'image';
}

export function normalizePost(post: any): Post {
  const challengeEntries = getChallengeEntries(post);
  const primaryChallenge =
    post?.challenge ||
    post?.competition ||
    post?.challengePost?.challenge ||
    post?.challenge_post?.challenge ||
    challengeEntries[0]?.challenge ||
    challengeEntries[0]?.competition;
  const explicitImage = post?.type === 'image' || post?.mediaType === 'image';
  const explicitVideo = post?.type === 'video' || post?.mediaType === 'video';
  const rawPlaybackUrl = pickString(
    post?.playback_url,
    post?.fullUrl,
    post?.hls_url ||
    post?.hlsUrl,
    post?.video_url,
    post?.videoUrl,
    post?.mediaUrl,
    post?.media_url,
  );
  const directImageUrl = pickString(post?.image, post?.imageUrl, post?.image_url, post?.imageURL);
  const fallbackImageUrl =
    explicitImage ||
    (!explicitVideo && isLikelyImageUrl(rawPlaybackUrl) && !isLikelyVideoUrl(rawPlaybackUrl))
      ? rawPlaybackUrl
      : '';
  const imageUrl = pickString(directImageUrl, fallbackImageUrl);
  const rawVideoUrl = pickString(
    post?.video_url,
    post?.videoUrl,
    post?.mediaUrl,
    post?.media_url,
    (post?.stream_type === 'raw' || post?.streamType === 'raw') && rawPlaybackUrl ? rawPlaybackUrl : '',
  );
  const hlsUrl =
    pickString(post?.hls_url, post?.hlsUrl) ||
    ((post?.stream_type === 'hls' || post?.streamType === 'hls' || rawPlaybackUrl?.toLowerCase?.().includes('.m3u8'))
      ? rawPlaybackUrl
      : '');
  const type = inferPostType(post, rawPlaybackUrl, rawVideoUrl, imageUrl);
  const resolvedImageUrl =
    type === 'image'
      ? pickString(directImageUrl, fallbackImageUrl, rawPlaybackUrl, rawVideoUrl)
      : imageUrl;
  const videoUrl =
    type === 'video'
      ? pickString(
          rawVideoUrl,
          (post?.stream_type === 'raw' || post?.streamType === 'raw') && rawPlaybackUrl ? rawPlaybackUrl : '',
        )
      : '';
  const playbackUrl =
    type === 'image'
      ? pickString(imageUrl, rawPlaybackUrl)
      : pickString(post?.playback_url, rawPlaybackUrl, hlsUrl, videoUrl);
  const streamType =
    type === 'image'
      ? null
      :
    post?.streamType ||
    post?.stream_type ||
    (hlsUrl ? 'hls' : videoUrl ? 'raw' : null);
  const processingStatus = post?.processingStatus || post?.processing_status || null;
  const hlsReady =
    type === 'image' ||
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
  const challengeId = pickString(
    primaryChallenge?.id,
    post?.challenge_id,
    post?.challengeId,
    post?.competition_id,
    post?.competitionId,
    challengeEntries[0]?.challenge_id,
    challengeEntries[0]?.challengeId,
  );
  const challengeName = pickString(
    primaryChallenge?.name,
    post?.challenge_name,
    post?.challengeName,
    post?.competition_name,
    post?.competitionName,
    challengeEntries[0]?.challenge?.name,
    challengeEntries[0]?.competition?.name,
  );

  return {
    ...post,
    type,
    mediaType: type,
    image: pickString(post?.image, resolvedImageUrl),
    imageUrl: pickString(post?.imageUrl, resolvedImageUrl),
    video_url: videoUrl,
    videoUrl: type === 'video' ? pickString(post?.videoUrl, videoUrl) : '',
    hls_url: hlsUrl,
    hlsUrl: post?.hlsUrl || hlsUrl,
    playback_url: type === 'video' ? pickString(post?.playback_url, playbackUrl, hlsUrl) : '',
    fullUrl: type === 'image' ? pickString(post?.fullUrl, resolvedImageUrl, playbackUrl) : pickString(playbackUrl, hlsUrl, videoUrl, resolvedImageUrl),
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
    challenge: primaryChallenge || post?.challenge || post?.competition,
    challenge_id: challengeId || undefined,
    challengeId: challengeId || undefined,
    challenge_name: challengeName || undefined,
    challengeName: challengeName || undefined,
    challengePosts: post?.challengePosts ?? post?.challenge_posts,
    challenge_posts: post?.challenge_posts ?? post?.challengePosts,
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
