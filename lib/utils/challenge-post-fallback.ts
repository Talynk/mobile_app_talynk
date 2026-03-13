import { challengesApi, postsApi, userApi } from '@/lib/api';
import { Post } from '@/types';
import { getChallengePostMeta } from '@/lib/utils/challenge-post';
import { normalizePost } from '@/lib/utils/normalize-post';
import { filterHlsReady } from '@/lib/utils/post-filter';

const PARTICIPANT_LIMIT = 100;
const USER_POST_LIMIT = 100;

function getUserIdFromParticipantRow(participant: any): string | null {
  return participant?.user?.id || participant?.user_id || null;
}

function extractPostsArray(payload: any): any[] {
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.data?.posts)) {
    return payload.data.posts;
  }

  if (Array.isArray(payload?.posts)) {
    return payload.posts;
  }

  return [];
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
): Promise<{
  posts: Post[];
  likesMap: Record<string, number>;
  participants: any[];
}> {
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
    participantIds.map((participantId) => userApi.getUserPosts(participantId, 1, USER_POST_LIMIT, 'approved')),
  );

  const candidatePosts = new Map<string, any>();

  participantPostsResults.forEach((result, index) => {
    if (result.status !== 'fulfilled' || result.value?.status !== 'success') {
      return;
    }

    extractPostsArray(result.value).forEach((post: any) => {
      if (!post?.id || candidatePosts.has(post.id)) {
        return;
      }

      candidatePosts.set(post.id, {
        ...post,
        user_id: post?.user_id || post?.userId || participantIds[index],
      });
    });
  });

  const candidateList = Array.from(candidatePosts.values());

  if (candidateList.length === 0) {
    return {
      posts: [],
      likesMap: {},
      participants,
    };
  }

  const postDetailsResults = await Promise.allSettled(
    candidateList.map((post) => postsApi.getById(post.id)),
  );

  const likesMap: Record<string, number> = {};
  const challengePosts = new Map<string, Post>();

  postDetailsResults.forEach((result, index) => {
    const candidatePost = candidateList[index];
    const fullPost =
      result.status === 'fulfilled' && result.value?.status === 'success' && result.value?.data
        ? result.value.data
        : candidatePost;

    const mergedPost = {
      ...candidatePost,
      ...fullPost,
      user: (fullPost as any)?.user || candidatePost?.user,
      challengePosts: (fullPost as any)?.challengePosts ?? candidatePost?.challengePosts,
      challenge_posts: (fullPost as any)?.challenge_posts ?? candidatePost?.challenge_posts,
    };

    const matchingEntry = getMatchingChallengeEntry(mergedPost, challengeId);
    const challengeMeta = getChallengePostMeta(mergedPost);

    if (!matchingEntry && challengeMeta.challengeId !== challengeId) {
      return;
    }

    const snapshotLikes = getChallengePostSnapshotLikes(mergedPost, challengeId);
    const normalizedPost = normalizePost({
      ...mergedPost,
      challenge_id: challengeId,
      challengeId: challengeId,
      challenge_posts: mergedPost.challenge_posts,
      challengePosts: mergedPost.challengePosts,
      likes_during_challenge: snapshotLikes,
      likes_at_challenge_end: snapshotLikes,
      submitted_at:
        matchingEntry?.submitted_at ||
        mergedPost?.submitted_at ||
        mergedPost?.createdAt ||
        mergedPost?.uploadDate ||
        mergedPost?.created_at,
      total_likes:
        mergedPost?.total_likes ??
        mergedPost?.likes ??
        mergedPost?.like_count ??
        candidatePost?.likesCount ??
        0,
    });

    likesMap[normalizedPost.id] = snapshotLikes;

    challengePosts.set(normalizedPost.id, {
      ...normalizedPost,
      challenge_id: challengeId,
      challengeId: challengeId,
      challenge_posts: mergedPost.challenge_posts,
      challengePosts: mergedPost.challengePosts,
      likes_during_challenge: snapshotLikes,
      likes_at_challenge_end: snapshotLikes,
      total_likes: Number(
        mergedPost?.total_likes ??
          mergedPost?.likes ??
          mergedPost?.like_count ??
          normalizedPost?.likes ??
          normalizedPost?.like_count ??
          0,
      ),
      submitted_at:
        matchingEntry?.submitted_at ||
        mergedPost?.submitted_at ||
        normalizedPost?.createdAt ||
        normalizedPost?.uploadDate ||
        (normalizedPost as any)?.created_at,
    } as Post);
  });

  return {
    posts: sortChallengePostsByLikes(
      filterHlsReady(Array.from(challengePosts.values())),
      likesMap,
      true,
    ),
    likesMap,
    participants,
  };
}
