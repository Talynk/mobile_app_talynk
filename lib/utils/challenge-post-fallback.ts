import { challengesApi } from '@/lib/api';
import { Post } from '@/types';
import { normalizePost } from '@/lib/utils/normalize-post';
import { prepareRenderableChallengePosts } from '@/lib/utils/challenge-post-visibility';

const PARTICIPANT_LIMIT = 100;
const USER_POST_LIMIT = 100;
const FALLBACK_CACHE_TTL_MS = 30_000;

type FallbackChallengeData = {
  posts: Post[];
  likesMap: Record<string, number>;
  participants: any[];
};

const fallbackChallengeCache = new Map<
  string,
  { loadedAt: number; data: FallbackChallengeData } | { promise: Promise<FallbackChallengeData> }
>();

function getUserIdFromParticipantRow(participant: any): string | null {
  return participant?.user?.id || participant?.user_id || null;
}

function getChallengeEntries(post: any): any[] {
  const entries = [
    ...(Array.isArray(post?.challengePosts) ? post.challengePosts : []),
    ...(Array.isArray(post?.challenge_posts) ? post.challenge_posts : []),
    ...(post?.challengePost ? [post.challengePost] : []),
    ...(post?.challenge_post ? [post.challenge_post] : []),
  ];

  return entries.filter(Boolean);
}

export function getMatchingChallengeEntry(post: any, challengeId: string): any | null {
  return (
    getChallengeEntries(post).find((entry: any) => {
      const entryChallengeId =
        entry?.challenge_id ||
        entry?.challengeId ||
        entry?.challenge?.id ||
        entry?.challenge?.challenge_id;

      return entryChallengeId === challengeId;
    }) || null
  );
}

export function getChallengePostSnapshotLikes(post: any, challengeId?: string): number {
  const matchingEntry = challengeId ? getMatchingChallengeEntry(post, challengeId) : null;
  return Number(
    matchingEntry?.likes_during_challenge ??
      matchingEntry?.likes_at_challenge_end ??
      post?.likes_during_challenge ??
      post?.likes_at_challenge_end ??
      post?.total_likes ??
      post?.likes ??
      post?.like_count ??
      0,
  );
}

export function getChallengePostTimestamp(post: any): number {
  return new Date(post?.submitted_at || post?.createdAt || post?.uploadDate || post?.created_at || 0).getTime();
}

export function sortChallengePostsByLikes<T extends { id?: string }>(
  posts: T[],
  likesMap: Record<string, number>,
  useChallengeLikes: boolean,
): T[] {
  return [...posts].sort((a: any, b: any) => {
    const likesA = useChallengeLikes
      ? likesMap[a?.id || ''] ?? 0
      : Number(a?.likes ?? a?.like_count ?? a?.total_likes ?? 0);
    const likesB = useChallengeLikes
      ? likesMap[b?.id || ''] ?? 0
      : Number(b?.likes ?? b?.like_count ?? b?.total_likes ?? 0);

    if (likesB !== likesA) {
      return likesB - likesA;
    }

    return getChallengePostTimestamp(b) - getChallengePostTimestamp(a);
  });
}

export function buildWinnerEntriesFromPosts(posts: any[], likesMap: Record<string, number>) {
  return sortChallengePostsByLikes(posts, likesMap, true).map((post: any, index: number) => ({
    ...post,
    winner_rank: Number(post?.winner_rank ?? index + 1),
    likes_during_challenge: likesMap[post.id] ?? getChallengePostSnapshotLikes(post),
    likes_at_challenge_end: likesMap[post.id] ?? getChallengePostSnapshotLikes(post),
    total_likes: Number(post?.total_likes ?? post?.likes ?? post?.like_count ?? 0),
    submitted_at: post?.submitted_at || post?.createdAt || post?.uploadDate || post?.created_at,
  }));
}

export async function loadFallbackChallengePosts(
  challengeId: string,
  participantSeed?: any[],
): Promise<FallbackChallengeData> {
  const cached = fallbackChallengeCache.get(challengeId);
  if (cached && 'data' in cached && Date.now() - cached.loadedAt < FALLBACK_CACHE_TTL_MS) {
    return cached.data;
  }

  if (cached && 'promise' in cached) {
    return cached.promise;
  }

  const loadPromise = (async (): Promise<FallbackChallengeData> => {
  let participants = Array.isArray(participantSeed) ? participantSeed : [];

  if (participants.length === 0) {
    const rankingResponse = await challengesApi.getParticipantsRanking(challengeId, 1, PARTICIPANT_LIMIT);
    participants =
      rankingResponse?.status === 'success' && Array.isArray(rankingResponse.data?.participants)
        ? rankingResponse.data.participants
        : [];
  }

  const participantIds = [...new Set(participants.map(getUserIdFromParticipantRow).filter(Boolean))] as string[];

  if (participantIds.length === 0) {
    return {
      posts: [],
      likesMap: {},
      participants,
    };
  }

  const participantPostsResults = await Promise.allSettled(
    participantIds.map((participantId) =>
      challengesApi.getParticipantPosts(challengeId, participantId, 1, USER_POST_LIMIT),
    ),
  );

  const likesMap: Record<string, number> = {};
  const challengePosts = new Map<string, Post>();

  participantPostsResults.forEach((result, index) => {
    if (result.status !== 'fulfilled' || result.value?.status !== 'success') {
      return;
    }

    const rawItems = Array.isArray(result.value.data?.rawItems) ? result.value.data.rawItems : [];
    const posts = Array.isArray(result.value.data?.posts) ? result.value.data.posts : [];
    const rawItemsByPostId = new Map<string, any>();

    rawItems.forEach((rawItem: any) => {
      const postId = rawItem?.post?.id ?? rawItem?.post_id;
      if (postId) {
        rawItemsByPostId.set(postId, rawItem);
      }
    });

    posts.forEach((post: any) => {
      if (!post?.id || challengePosts.has(post.id)) {
        return;
      }

      const matchingEntry = rawItemsByPostId.get(post.id) ?? getMatchingChallengeEntry(post, challengeId);
      const snapshotLikes = getChallengePostSnapshotLikes(
        matchingEntry ? { ...post, challenge_post: matchingEntry } : post,
        challengeId,
      );

      const normalizedPost = normalizePost({
        ...post,
        user_id: post?.user_id || post?.userId || participantIds[index],
        challenge_id: challengeId,
        challengeId: challengeId,
        challenge_posts: post?.challenge_posts,
        challengePosts: post?.challengePosts,
        likes_during_challenge: snapshotLikes,
        likes_at_challenge_end: snapshotLikes,
        submitted_at:
          matchingEntry?.submitted_at ||
          post?.submitted_at ||
          post?.createdAt ||
          post?.uploadDate ||
          post?.created_at,
        total_likes:
          post?.total_likes ??
          post?.likes ??
          post?.like_count ??
          0,
      });

      likesMap[normalizedPost.id] = snapshotLikes;

      challengePosts.set(normalizedPost.id, {
        ...normalizedPost,
        challenge_id: challengeId,
        challengeId: challengeId,
        challenge_posts: post?.challenge_posts,
        challengePosts: post?.challengePosts,
        likes_during_challenge: snapshotLikes,
        likes_at_challenge_end: snapshotLikes,
        total_likes: Number(
          post?.total_likes ??
            post?.likes ??
            post?.like_count ??
            normalizedPost?.likes ??
            normalizedPost?.like_count ??
            0,
        ),
        submitted_at:
          matchingEntry?.submitted_at ||
          post?.submitted_at ||
          normalizedPost?.createdAt ||
          normalizedPost?.uploadDate ||
          (normalizedPost as any)?.created_at,
      } as Post);
    });
  });

  return {
    posts: sortChallengePostsByLikes(
      await prepareRenderableChallengePosts(Array.from(challengePosts.values()), {
        preserveUnavailableVideos: true,
      }),
      likesMap,
      true,
    ),
    likesMap,
    participants,
  };
  })();

  fallbackChallengeCache.set(challengeId, { promise: loadPromise });

  try {
    const data = await loadPromise;
    fallbackChallengeCache.set(challengeId, {
      data,
      loadedAt: Date.now(),
    });
    return data;
  } catch (error) {
    fallbackChallengeCache.delete(challengeId);
    throw error;
  }
}
