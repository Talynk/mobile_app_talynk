import { DETOUR_DEFERRED_LINK_BASE } from '@/lib/detour-config';

/** Share link: https://talentix.godetour.link/mIlEGaC9ru/v/{postId} */
export function buildSharedPostUrl(postId: string): string {
  return `${DETOUR_DEFERRED_LINK_BASE}/v/${encodeURIComponent(postId)}`;
}
