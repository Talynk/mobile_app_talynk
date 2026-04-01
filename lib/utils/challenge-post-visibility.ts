import { Post } from '@/types';
import { getFileUrl, getPlaybackUrl, getThumbnailUrl } from '@/lib/utils/file-url';
import { normalizePost } from '@/lib/utils/normalize-post';
import {
  needsChallengeMetaEnrichment,
  needsRenderableMediaEnrichment,
} from '@/lib/utils/post-detail-enrichment';
import { getPostDetailsCached } from '@/lib/post-details-cache';
import { getPostVideoAssetsBatchCached } from '@/lib/post-video-assets-cache';

function dedupePostsById(posts: Post[]): Post[] {
  const byId = new Map<string, Post>();

  posts.forEach((post) => {
    if (!post?.id) {
      return;
    }

    byId.set(post.id, {
      ...(byId.get(post.id) || {}),
      ...post,
    });
  });

  return Array.from(byId.values());
}

type PrepareChallengePostsOptions = {
  preserveUnavailableVideos?: boolean;
};

export function hasRenderableChallengeMedia(post: any): boolean {
  const normalized = normalizePost(post);
  const isVideo =
    normalized.type === 'video' ||
    normalized.mediaType === 'video' ||
    !!(normalized.video_url || normalized.videoUrl);

  if (!isVideo) {
    return Boolean(
      getFileUrl(
        normalized.image ||
          normalized.imageUrl ||
          normalized.fullUrl ||
          normalized.playback_url ||
          '',
      ),
    );
  }

  return Boolean(
    getPlaybackUrl(normalized) ||
      getThumbnailUrl(normalized),
  );
}

function shouldKeepUnavailableChallengeVideo(
  post: any,
  options: PrepareChallengePostsOptions = {},
): boolean {
  if (!options.preserveUnavailableVideos) {
    return false;
  }

  const normalized = normalizePost(post) as any;
  const isVideo =
    normalized.type === 'video' ||
    normalized.mediaType === 'video' ||
    !!(normalized.video_url || normalized.videoUrl);

  if (!isVideo) {
    return false;
  }

  return Boolean(
    normalized.id &&
      (
        normalized.processing_status ||
        normalized.processingStatus ||
        normalized.video_url ||
        normalized.videoUrl
      ),
  );
}

export function getChallengeVideoStatusLabel(post: any): string | null {
  const normalized = normalizePost(post) as any;
  const status = String(normalized.processing_status || normalized.processingStatus || '').toLowerCase();

  if (status === 'pending') {
    return 'Queued';
  }

  if (status === 'processing') {
    return 'Processing';
  }

  if (status === 'failed') {
    return 'Unavailable';
  }

  if (
    normalized.type === 'video' ||
    normalized.mediaType === 'video' ||
    normalized.video_url ||
    normalized.videoUrl
  ) {
    return 'Video';
  }

  return null;
}

export async function prepareRenderableChallengePosts(
  inputPosts: any[],
  options: PrepareChallengePostsOptions = {},
): Promise<Post[]> {
  if (!Array.isArray(inputPosts) || inputPosts.length === 0) {
    return [];
  }

  let posts = dedupePostsById(
    inputPosts
      .map((post) => normalizePost(post))
      .filter((post) => !!post?.id),
  );

  const postsNeedingEnrichment = posts.filter(
    (post) =>
      needsRenderableMediaEnrichment(post) ||
      needsChallengeMetaEnrichment(post) ||
      !hasRenderableChallengeMedia(post),
  );

  if (postsNeedingEnrichment.length > 0) {
    const [videoAssetsMap, enrichMap] = await Promise.all([
      getPostVideoAssetsBatchCached(
        postsNeedingEnrichment
          .filter((post) => post.type === 'video')
          .map((post) => post.id),
      ),
      getPostDetailsCached(postsNeedingEnrichment.map((post) => post.id), {
        requireNetwork: true,
      }),
    ]);

    posts = dedupePostsById(
      posts.map((post) => {
        const enriched = enrichMap.get(post.id);
        const videoAssets = videoAssetsMap.get(post.id);

        if (!enriched && !videoAssets) {
          return post;
        }

        return normalizePost({
          ...post,
          ...videoAssets,
          ...enriched,
          user: enriched?.user || post.user,
          challenge: enriched?.challenge || enriched?.competition || post.challenge,
          challenge_id:
            enriched?.challenge_id ||
            enriched?.challengeId ||
            post.challenge_id ||
            post.challengeId,
          challengeId:
            enriched?.challengeId ||
            enriched?.challenge_id ||
            post.challengeId ||
            post.challenge_id,
          challenge_name:
            enriched?.challenge_name ||
            enriched?.challengeName ||
            post.challenge_name ||
            post.challengeName,
          challengeName:
            enriched?.challengeName ||
            enriched?.challenge_name ||
            post.challengeName ||
            post.challenge_name,
        });
      }),
    );
  }

  return posts.filter(
    (post) => hasRenderableChallengeMedia(post) || shouldKeepUnavailableChallengeVideo(post, options),
  );
}
