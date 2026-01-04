import { Post } from '@/types';

/**
 * Post Status Helper Functions
 * Per NOTIFICATIONS&REPORTING.md specification
 */

export type PostStatusType = 'draft' | 'active' | 'suspended' | 'unknown';

/**
 * Get the effective status of a post
 * Checks both status and is_frozen flag
 */
export const getPostStatus = (post: Post): PostStatusType => {
  if (post.status === 'draft') return 'draft';
  if (post.status === 'suspended') return 'suspended';
  if (post.status === 'active' && post.is_frozen) return 'suspended';
  if (post.status === 'active' && !post.is_frozen) return 'active';
  return 'unknown';
};

/**
 * Check if post is visible in public feed
 * Only active posts that are not frozen should be visible
 */
export const isPostVisibleInPublicFeed = (post: Post): boolean => {
  return post.status === 'active' && !post.is_frozen;
};

/**
 * Check if post is visible to owner
 * Owner can see all their posts (draft, active, suspended)
 */
export const isPostVisibleToOwner = (post: Post, userId: string): boolean => {
  return post.user_id === userId;
};

/**
 * Check if post is suspended
 * Suspended = status === 'suspended' OR (status === 'active' && is_frozen === true)
 */
export const isPostSuspended = (post: Post): boolean => {
  return post.status === 'suspended' || (post.status === 'active' && post.is_frozen === true);
};

/**
 * Check if post is a draft
 */
export const isPostDraft = (post: Post): boolean => {
  return post.status === 'draft';
};

/**
 * Check if post is active (not draft, not suspended)
 */
export const isPostActive = (post: Post): boolean => {
  return post.status === 'active' && !post.is_frozen;
};

/**
 * Filter posts for public feed
 * Removes drafts and suspended posts
 */
export const filterPublicPosts = (posts: Post[]): Post[] => {
  return posts.filter(post => isPostVisibleInPublicFeed(post));
};

/**
 * Filter posts for user profile
 * Includes all statuses (draft, active, suspended)
 */
export const filterUserPosts = (posts: Post[], userId: string): Post[] => {
  return posts.filter(post => post.user_id === userId);
};

/**
 * Get status badge text and color
 */
export const getPostStatusBadge = (post: Post): { text: string; color: string; bgColor: string } => {
  const status = getPostStatus(post);
  
  switch (status) {
    case 'draft':
      return {
        text: '📝 Draft',
        color: '#888',
        bgColor: 'rgba(136, 136, 136, 0.15)',
      };
    case 'suspended':
      return {
        text: `⚠️ Suspended${post.report_count ? ` (${post.report_count} reports)` : ''}`,
        color: '#f59e0b',
        bgColor: 'rgba(245, 158, 11, 0.15)',
      };
    case 'active':
      return {
        text: '✓ Active',
        color: '#10b981',
        bgColor: 'rgba(16, 185, 129, 0.15)',
      };
    default:
      return {
        text: 'Unknown',
        color: '#666',
        bgColor: 'rgba(102, 102, 102, 0.15)',
      };
  }
};


