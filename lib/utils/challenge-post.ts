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
  const challenge = post?.challenge || post?.competition || post?.challenge_post?.challenge;
  const challengeId = pickString(
    challenge?.id,
    post?.challenge_id,
    post?.challengeId,
    post?.competition_id,
    post?.competitionId
  );
  const challengeName = pickString(
    challenge?.name,
    post?.challenge_name,
    post?.challengeName,
    post?.competition_name,
    post?.competitionName
  );

  return {
    isChallengePost: Boolean(challenge || challengeId || challengeName),
    challengeId,
    challengeName,
  };
}
