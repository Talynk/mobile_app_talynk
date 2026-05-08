/**
 * Post filter utilities for feed vs profile visibility.
 *
 * FEED RULE: Video posts appear in feeds only when processing is complete.
 * Profile: All posts (including processing) are shown on user profile.
 */

/**
 * Prisma where clause: only posts that are ready for feed display.
 * - Images: always ready
 * - Videos: only when processing_status === 'completed'
 */
const FEED_READY_FILTER = {
  OR: [
    { type: { not: 'video' } },
    { type: 'video', processing_status: 'completed' }
  ]
};

/**
 * Merge feed-ready filter into an existing where clause
 * @param {Object} where - Existing Prisma where clause
 * @returns {Object} - Merged where with AND
 */
function applyFeedReadyFilter(where = {}) {
  return {
    ...where,
    ...FEED_READY_FILTER
  };
}

/**
 * Use when where clause already has OR - combine with AND to avoid overwriting
 */
function andFeedReadyFilter(where) {
  return {
    ...where,
    AND: [...(where.AND || []), FEED_READY_FILTER]
  };
}

/**
 * User-friendly label for processing status (for mobile UX)
 */
const PROCESSING_STATUS_LABELS = {
  uploading: 'Uploading',
  pending: 'Waiting in queue',
  processing: 'Processing',
  completed: 'Ready',
  failed: 'Processing failed'
};

function getProcessingStatusLabel(status) {
  return PROCESSING_STATUS_LABELS[status] || status || 'Unknown';
}

module.exports = {
  FEED_READY_FILTER,
  applyFeedReadyFilter,
  andFeedReadyFilter,
  PROCESSING_STATUS_LABELS,
  getProcessingStatusLabel
};
