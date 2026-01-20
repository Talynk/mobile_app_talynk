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
  if (__DEV__) {
    console.log('🔍 [getFileUrl] Input:', relativePath, 'Type:', typeof relativePath);
  }

  if (!relativePath || typeof relativePath !== 'string') {
    if (__DEV__) {
      console.warn('⚠️ [getFileUrl] Invalid path:', relativePath);
    }
    return null;
  }

  // If already a full URL (starts with http), return as-is
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    if (__DEV__) {
      console.log('✅ [getFileUrl] Already full URL:', relativePath);
    }
    return relativePath;
  }

  // If it's a relative path starting with /uploads/, prepend API base URL
  if (relativePath.startsWith('/uploads/')) {
    const fullUrl = `${API_BASE_URL}${relativePath}`;
    if (__DEV__) {
      console.log('✅ [getFileUrl] Converted /uploads/ path:', fullUrl);
    }
    return fullUrl;
  }

  // If it doesn't start with /uploads/ but is a relative path, add /uploads/ prefix
  // This handles cases where the path might be just "filename.mp4"
  if (relativePath.startsWith('/')) {
    // Already starts with /, just prepend API base URL
    const fullUrl = `${API_BASE_URL}${relativePath}`;
    if (__DEV__) {
      console.log('✅ [getFileUrl] Converted / path:', fullUrl);
    }
    return fullUrl;
  }

  // If it's a filename without path, assume it's in /uploads/
  const fullUrl = `${API_BASE_URL}/uploads/${relativePath.replace(/^uploads\//, '')}`;
  if (__DEV__) {
    console.log('✅ [getFileUrl] Converted filename:', fullUrl);
  }
  return fullUrl;
}

/**
 * Gets the media URL from a post object
 * Checks multiple possible fields and converts to full URL
 * 
 * @param post - Post object with potential media fields
 * @returns Full media URL or null
 */
export function getPostMediaUrl(post: any): string | null {
  // Log post structure for debugging
  if (__DEV__) {
    console.log('📦 [getPostMediaUrl] Post structure:', {
      id: post?.id,
      type: post?.type,
      fullUrl: post?.fullUrl,
      video_url: post?.video_url,
      image: post?.image,
      imageUrl: post?.imageUrl,
      allKeys: post ? Object.keys(post) : [],
    });
  }

  // Check for fullUrl first (from API response), then various video / image fields
  const url =
    post?.fullUrl ||
    post?.video_url ||
    post?.videoUrl ||
    post?.image ||
    post?.imageUrl ||
    post?.mediaUrl ||
    '';
  
  if (__DEV__) {
    console.log('🔗 [getPostMediaUrl] Found URL:', url);
  }
  
  if (!url || url.trim() === '') {
    if (__DEV__) {
      console.warn('⚠️ [getPostMediaUrl] No URL found for post:', post?.id);
    }
    return null;
  }

  const fullUrl = getFileUrl(url);
  if (__DEV__) {
    console.log('✅ [getPostMediaUrl] Converted to:', fullUrl);
  }
  
  return fullUrl;
}

/**
 * Gets the thumbnail URL from a post object
 * 
 * @param post - Post object with potential thumbnail fields
 * @returns Full thumbnail URL or null
 */
export function getThumbnailUrl(post: any): string | null {
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




