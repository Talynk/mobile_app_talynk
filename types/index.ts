// Type definitions for the mobile app

export interface ApiResponse<T> {
  status: 'success' | 'error';
  message: string;
  data: T;
}

// Auth / Registration specific types

export interface LoginResponseData {
  accessToken: string;
  refreshToken: string;
  user: any;
}

export interface RegisterFormData {
  username?: string;
  email?: string;
  password: string;
  phone1: string;
  phone2?: string;
  country_id: number;
}

// New OTP-based registration flow types
export interface RegisterOtpVerifyData {
  verificationToken: string;
  email: string;
}

export interface RegisterCompletePayload {
  verificationToken: string;
  username: string;
  display_name: string;
  password: string;
  country_id: number;
  date_of_birth: string;
  email?: string;
  phone1?: string;
  phone2?: string;
}

// Password reset (OTP-based) types
export interface PasswordResetVerifyData {
  resetToken: string;
  email: string;
}

export interface Country {
  id: number;
  name: string;
  code: string;
  flag_emoji?: string;
}

export interface Post {
  id: string;
  title?: string;
  description?: string;
  caption?: string;
  content?: string;
  image?: string;
  imageUrl?: string;
  video_url?: string;
  videoUrl?: string;
  mediaType?: 'image' | 'video';
  type?: 'image' | 'video';
  // HLS STREAMING FIELDS (from backend withVideoPlaybackUrl)
  fullUrl?: string; // Primary playback URL - HLS when ready, else raw MP4
  streamType?: 'hls' | 'raw'; // Tells frontend which player to use
  hlsReady?: boolean; // true when HLS is available
  hls_url?: string; // HLS master playlist (.m3u8)
  thumbnail_url?: string; // Server-generated thumbnail for instant display
  video_duration?: number; // Duration in seconds
  processing_status?: 'pending' | 'processing' | 'completed' | 'failed';
  // END HLS STREAMING FIELDS
  createdAt: string;
  updatedAt: string;
  uploadDate?: string;
  user_id?: string;
  user_name?: string;
  authorName?: string;
  user_avatar?: string;
  authorProfilePicture?: string;
  likes?: number;
  likesCount?: number;
  comments_count?: number;
  commentsCount?: number;
  comment_count?: number;
  shares?: number;
  views?: number;
  comments?: Comment[];
  status?: 'active' | 'draft' | 'Draft' | 'suspended' | 'approved' | 'pending' | 'rejected'; // New statuses + legacy support
  is_featured?: boolean;
  is_frozen?: boolean;
  report_count?: number;
  featured_at?: string | null;
  frozen_at?: string | null;
  approver_id?: string | null;
  admin_id?: string | null;
  approved_at?: string | null;
  user?: {
    id: string;
    name?: string;
    username?: string;
    profile_picture?: string | null;
    country?: {
      id: number;
      name: string;
      code: string;
      flag_emoji?: string;
    };
  };
  category?: {
    id: number;
    name: string;
  };
  category_id?: number;
  categoryName?: string;
}

export interface Comment {
  id: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    avatar: string;
  };
}

export interface User {
  id: string;
  name: string;
  email: string;
  username?: string;
  avatar?: string;
  profile_picture?: string;
  bio?: string;
  followers_count?: number;
  following_count?: number;
  posts_count?: number;
}

// Notification interface matching NOTIFICATIONS.md backend spec
export interface Notification {
  id: number;
  userID: string; // Username, not UUID
  message: string;
  type?: string; // comment, like, follow, challenge_approved, challenge_rejected, post_status_update, post_approved, post_rejected, post_review, view_milestone, comment_report, etc.
  isRead: boolean;
  createdAt: string;
  // Metadata field as per API documentation
  metadata?: {
    postId?: string;
    postTitle?: string;
    challengeId?: string;
    challengeName?: string;
    milestone?: number;
    views?: number;
    status?: string;
    reason?: string;
  };
  // Legacy fields for backward compatibility
  notification_id?: number;
  user_id?: string;
  notification_text?: string;
  notification_date?: string;
  is_read?: boolean;
  // Additional fields that might be present
  related_post_id?: string;
  related_user_id?: string;
  related_user?: {
    username?: string;
    profile_picture?: string;
  };
}

export interface NotificationResponse {
  notifications: Notification[];
}

export interface RecentSearch {
  search_term: string;
  search_date: string;
}

export interface RecentSearchesResponse {
  searches: RecentSearch[];
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  loading: boolean;
} 