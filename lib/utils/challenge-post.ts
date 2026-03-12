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

export function getChallengePostMeta(post: any): ChallengePostMeta {
  // Backend can attach challenge in several shapes:
  // - post.challenge
  // - post.competition
  // - post.challenge_post.challenge
  // - post.challenge_posts[0].challenge
  const primaryChallenge =
    post?.challenge ||
    post?.competition ||
    post?.challenge_post?.challenge ||
    (Array.isArray(post?.challenge_posts) ? post.challenge_posts[0]?.challenge : undefined);

  const challengeId = pickString(
    primaryChallenge?.id,
    post?.challenge_id,
    post?.challengeId,
    post?.competition_id,
    post?.competitionId,
    // Some backends expose challenge_posts with challenge_id on the pivot
    Array.isArray(post?.challenge_posts) ? post.challenge_posts[0]?.challenge_id : undefined
  );
  const challengeName = pickString(
    primaryChallenge?.name,
    post?.challenge_name,
    post?.challengeName,
    post?.competition_name,
    post?.competitionName
  );

  return {
    isChallengePost: Boolean(primaryChallenge || challengeId || challengeName),
    challengeId,
    challengeName,
  };
}
