import { API_BASE_URL } from '@/lib/config';

/**
 * Converts a relative file path from the API to a full URL
 * 
 * @param relativePath - The relative path from API (e.g., "/uploads/filename.mp4")
 * @returns Full URL or null if path is invalid
 * 
 * @example
 * getFileUrl("/uploads/file.mp4") 
 * // Returns: "https://api.talentix.net/uploads/file.mp4"
 * 
 * getFileUrl("https://example.com/file.jpg")
 * // Returns: "https://example.com/file.jpg" (already full URL)
 */
export function getFileUrl(relativePath: string | null | undefined): string | null {
  if (!relativePath || typeof relativePath !== 'string' || relativePath.trim() === '') {
    return null;
  }

  // If already a full URL (starts with http), return as-is
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }

  // If it's a relative path starting with /uploads/, prepend API base URL
  if (relativePath.startsWith('/uploads/')) {
    return `${API_BASE_URL}${relativePath}`;
  }

  // If it doesn't start with /uploads/ but is a relative path, add /uploads/ prefix
  // This handles cases where the path might be just "filename.mp4"
  if (relativePath.startsWith('/')) {
    // Already starts with /, just prepend API base URL
    return `${API_BASE_URL}${relativePath}`;
  }

  // If it's a filename without path, assume it's in /uploads/
  return `${API_BASE_URL}/uploads/${relativePath.replace(/^uploads\//, '')}`;
}

/**
 * Gets the media URL from a post object
 * Checks multiple possible fields and converts to full URL
 * 
 * @param post - Post object with potential media fields
 * @returns Full media URL or null
 */
export function getPostMediaUrl(post: any): string | null {
  // Check for fullUrl first (from API response), then various video / image fields
  const url =
    post?.fullUrl ||
    post?.video_url ||
    post?.videoUrl ||
    post?.image ||
    post?.imageUrl ||
    post?.mediaUrl ||
    '';

  if (!url || url.trim() === '') {
    return null;
  }

  return getFileUrl(url);
}

/**
 * Gets the thumbnail URL from a post object
 * PRIORITY: Server-generated thumbnail_url (faster, better quality)
 * 
 * @param post - Post object with potential thumbnail fields
 * @returns Full thumbnail URL or null
 */
export function getThumbnailUrl(post: any): string | null {
  // Server-generated thumbnail takes priority (from HLS processing)
  const url = post?.thumbnail_url || post?.thumbnail || '';

  if (!url || url.trim() === '') {
    return null;
  }

  return getFileUrl(url);
}

/**
 * Gets the profile picture URL from a user object
 * 
 * @param user - User object with potential profile picture fields
 * @param fallback - Optional fallback URL if no profile picture
 * @returns Full profile picture URL or fallback
 */
export function getProfilePictureUrl(user: any, fallback?: string): string | null {
  const url = user?.profile_picture || user?.avatar || user?.authorProfilePicture || '';

  if (!url || url.trim() === '') {
    return fallback || null;
  }

  return getFileUrl(url);
}

/**
 * Check if a post's video is HLS-ready (adaptive streaming available)
 * When HLS is ready, use fullUrl (which will be the .m3u8 playlist)
 * When not ready, use video_url (raw MP4)
 * 
 * @param post - Post object with HLS fields from API
 * @returns true if HLS streaming is available
 */
export function isHlsReady(post: any): boolean {
  return post?.hlsReady === true ||
    (post?.hls_url && post?.processing_status === 'completed');
}

/**
 * Check if a post is still being processed for HLS
 * 
 * @param post - Post object with processing_status field
 * @returns true if video is still being transcoded
 */
export function isVideoProcessing(post: any): boolean {
  return post?.processing_status === 'pending' ||
    post?.processing_status === 'processing';
}

/**
 * Get the stream type for a post (for choosing video player configuration)
 * 
 * @param post - Post object with streamType field
 * @returns 'hls' | 'raw' | null
 */
export function getStreamType(post: any): 'hls' | 'raw' | null {
  if (post?.streamType) {
    return post.streamType;
  }
  // Infer from other fields if streamType not present
  if (isHlsReady(post)) {
    return 'hls';
  }
  if (post?.video_url || post?.videoUrl) {
    return 'raw';
  }
  return null;
}

/**
 * Check if a URL is an HLS playlist (.m3u8)
 * 
 * @param url - Media URL to check
 * @returns true if URL ends with .m3u8
 */
export function isHlsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.toLowerCase().includes('.m3u8');
}

/**
 * Get the playback URL for a post — HLS ONLY.
 * Returns the master .m3u8 playlist URL when HLS processing is complete.
 * Returns null when HLS is not ready (video still processing or failed).
 * 
 * IMPORTANT: The feed should NEVER play raw MP4 files. Only use this function
 * to get the video source URL. When this returns null, show thumbnail + processing state.
 * 
 * @param post - Post object from the API
 * @returns HLS master playlist URL, or null if not ready
 */
export function getPlaybackUrl(post: any): string | null {
  if (!post || post.type !== 'video') return null;

  // Only play when HLS is ready
  const hlsReady =
    post.processing_status === 'completed' &&
    (post.hls_url || post.fullUrl?.includes('.m3u8'));

  if (!hlsReady) return null;

  // Prefer hls_url, then fullUrl (which backend sets to hls_url when completed)
  const url = post.hls_url || post.fullUrl;
  if (!url) return null;

  return getFileUrl(url);
}

