export interface ChallengePostMeta {
  isChallengePost: boolean;
  challengeId?: string;
  challengeName?: string;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function getChallengeEntries(post: any): any[] {
  return [
    ...(Array.isArray(post?.challengePosts) ? post.challengePosts : []),
    ...(Array.isArray(post?.challenge_posts) ? post.challenge_posts : []),
    ...(post?.challengePost ? [post.challengePost] : []),
    ...(post?.challenge_post ? [post.challenge_post] : []),
  ].filter(Boolean);
}

export function getChallengePostMeta(post: any): ChallengePostMeta {
  const challengeEntries = getChallengeEntries(post);
  // Backend can attach challenge in several shapes:
  // - post.challenge
  // - post.competition
  // - post.challenge_post.challenge
  // - post.challenge_posts[0].challenge
  // - post.challengePosts[0].challenge
  const primaryChallenge =
    post?.challenge ||
    post?.competition ||
    post?.challengePost?.challenge ||
    post?.challenge_post?.challenge ||
    challengeEntries[0]?.challenge ||
    challengeEntries[0]?.competition;

  const challengeId = pickString(
    primaryChallenge?.id,
    post?.challenge_id,
    post?.challengeId,
    post?.competition_id,
    post?.competitionId,
    // Some backends expose challenge_posts with challenge_id on the pivot
    challengeEntries[0]?.challenge_id,
    challengeEntries[0]?.challengeId
  );
  const challengeName = pickString(
    primaryChallenge?.name,
    post?.challenge_name,
    post?.challengeName,
    post?.competition_name,
    post?.competitionName,
    challengeEntries[0]?.challenge?.name,
    challengeEntries[0]?.competition?.name
  );

  return {
    isChallengePost: Boolean(primaryChallenge || challengeId || challengeName),
    challengeId,
    challengeName,
  };
}
