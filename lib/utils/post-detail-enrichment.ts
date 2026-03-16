import { getChallengePostMeta } from './challenge-post';
import { getFileUrl, getThumbnailUrl } from './file-url';

const RECENT_UPLOAD_WINDOW_MS = 30 * 60 * 1000;

function pickChallengeSignal(post: any): boolean {
  return Boolean(
    post?.challenge ||
      post?.competition ||
      post?.challenge_id ||
      post?.challengeId ||
      post?.competition_id ||
      post?.competitionId ||
      post?.challenge_name ||
      post?.challengeName ||
      post?.competition_name ||
      post?.competitionName ||
      post?.challengePost ||
      post?.challenge_post ||
      (Array.isArray(post?.challengePosts) && post.challengePosts.length > 0) ||
      (Array.isArray(post?.challenge_posts) && post.challenge_posts.length > 0)
  );
}

export function getPostCreatedAtMs(post: any): number {
  return new Date(post?.createdAt || post?.uploadDate || post?.created_at || 0).getTime();
}

export function isRecentVideoUpload(post: any, maxAgeMs = RECENT_UPLOAD_WINDOW_MS): boolean {
  const createdAtMs = getPostCreatedAtMs(post);
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return false;
  }

  return Date.now() - createdAtMs < maxAgeMs;
}

export function needsChallengeMetaEnrichment(post: any): boolean {
  return pickChallengeSignal(post) && !getChallengePostMeta(post).isChallengePost;
}

export function isStaleVideoProcessing(post: any): boolean {
  const processingStatus = post?.processing_status ?? post?.processingStatus ?? '';

  return (
    post?.type === 'video' &&
    !!processingStatus &&
    processingStatus !== 'completed' &&
    processingStatus !== 'failed' &&
    !isRecentVideoUpload(post)
  );
}

export function needsRenderableMediaEnrichment(post: any): boolean {
  if (post?.type === 'image') {
    return !Boolean(
      getFileUrl(
        post?.image ||
          post?.imageUrl ||
          post?.image_url ||
          post?.fullUrl ||
          post?.video_url ||
          post?.videoUrl ||
          ''
      )
    );
  }

  if (post?.type === 'video') {
    return !Boolean(getThumbnailUrl(post));
  }

  return false;
}
