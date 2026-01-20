import { apiClient } from './api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ApiResponse,
  Post,
  User,
  Notification,
  LoginResponseData,
  RegisterFormData,
  Country,
  RegisterOtpVerifyData,
  RegisterCompletePayload,
  PasswordResetVerifyData,
} from '../types';

// Auth API
export const authApi = {
  login: async (usernameOrEmail: string, password: string): Promise<ApiResponse<LoginResponseData>> => {
    try {
      // Extract username and email from input
      let email: string;
      let username: string | undefined;

      if (usernameOrEmail.includes('@')) {
        // Input is an email
        email = usernameOrEmail;
        // Extract username from email (part before @)
        username = email.split('@')[0];
      } else {
        // Input is a username, construct email
        username = usernameOrEmail;
        email = `${username}@talynk.com`;
      }

      // Send both email and username to match Postman request format
      const response = await apiClient.post('/api/auth/login', {
        email,
        username,
        password,
        role: 'user'
      });
      return response.data;
    } catch (error: any) {
      // Enhanced error logging
      console.error('Login API error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url
      });

      return {
        status: 'error',
        message: error.response?.data?.message || error.message || 'Login failed',
        data: {} as LoginResponseData,
      };
    }
  },

  register: async (data: RegisterFormData): Promise<ApiResponse<LoginResponseData>> => {
    try {
      const response = await apiClient.post('/api/auth/register', data);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Registration failed',
        data: {} as LoginResponseData,
      };
    }
  },

  // New OTP-based registration flow
  requestRegistrationOtp: async (
    email: string
  ): Promise<ApiResponse<{ remainingSeconds?: number }>> => {
    try {
      const response = await apiClient.post('/api/auth/register/request-otp', { email });
      return response.data;
    } catch (error: any) {
      const message =
        error.response?.data?.message ||
        error.message ||
        'Failed to request verification code';

      const remainingSeconds = error.response?.data?.data?.remainingSeconds;

      return {
        status: 'error',
        message,
        data: { remainingSeconds },
      };
    }
  },

  verifyRegistrationOtp: async (
    email: string,
    otpCode: string
  ): Promise<ApiResponse<RegisterOtpVerifyData & { code?: string }>> => {
    try {
      const response = await apiClient.post('/api/auth/register/verify-otp', {
        email,
        otpCode,
      });
      return response.data;
    } catch (error: any) {
      const apiData = error.response?.data;
      const message =
        apiData?.message || error.message || 'Failed to verify code';

      return {
        status: 'error',
        message,
        data: {
          verificationToken: '',
          email,
          code: apiData?.data?.code,
        },
      };
    }
  },

  completeRegistration: async (
    payload: RegisterCompletePayload
  ): Promise<ApiResponse<{ user: any }>> => {
    try {
      const response = await apiClient.post('/api/auth/register/complete', payload);
      return response.data;
    } catch (error: any) {
      const apiData = error.response?.data;
      const message =
        apiData?.message || error.message || 'Registration failed';

      return {
        status: 'error',
        message,
        data: { user: null },
      };
    }
  },

  // Password reset (OTP-based) flow
  requestPasswordResetOtp: async (
    email: string
  ): Promise<ApiResponse<{ remainingSeconds?: number }>> => {
    try {
      const response = await apiClient.post('/api/auth/password-reset/request-otp', { email });
      return response.data;
    } catch (error: any) {
      const apiData = error.response?.data;
      const message =
        apiData?.message || error.message || 'Failed to request password reset code';

      const remainingSeconds = apiData?.data?.remainingSeconds;

      return {
        status: 'error',
        message,
        data: { remainingSeconds },
      };
    }
  },

  verifyPasswordResetOtp: async (
    email: string,
    otpCode: string
  ): Promise<ApiResponse<PasswordResetVerifyData & { code?: string }>> => {
    try {
      const response = await apiClient.post('/api/auth/password-reset/verify-otp', {
        email,
        otpCode,
      });
      return response.data;
    } catch (error: any) {
      const apiData = error.response?.data;
      const message =
        apiData?.message || error.message || 'Failed to verify password reset code';

      return {
        status: 'error',
        message,
        data: {
          resetToken: '',
          email,
          code: apiData?.data?.code,
        },
      };
    }
  },

  resetPassword: async (
    resetToken: string,
    newPassword: string
  ): Promise<ApiResponse<{}>> => {
    try {
      const response = await apiClient.post('/api/auth/password-reset/reset', {
        resetToken,
        newPassword,
      });
      return response.data;
    } catch (error: any) {
      const apiData = error.response?.data;
      const message =
        apiData?.message || error.message || 'Failed to reset password';

      return {
        status: 'error',
        message,
        data: {},
      };
    }
  },

  refresh: async (refreshToken: string): Promise<ApiResponse<{ accessToken: string }>> => {
    try {
      const response = await apiClient.post('/api/auth/refresh', { refreshToken });
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Token refresh failed',
        data: { accessToken: '' },
      };
    }
  },
};

// Countries API
export const countriesApi = {
  getAll: async (): Promise<ApiResponse<{ countries: Country[] }>> => {
    try {
      const response = await apiClient.get('/api/countries');
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch countries',
        data: { countries: [] },
      };
    }
  },
  search: async (q: string): Promise<ApiResponse<{ countries: Country[] }>> => {
    try {
      const response = await apiClient.get(`/api/countries/search?q=${encodeURIComponent(q)}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to search countries',
        data: { countries: [] },
      };
    }
  },
};

// Categories API
export const categoriesApi = {
  getAll: async (): Promise<ApiResponse<{ categories: any[] }>> => {
    try {
      const response = await apiClient.get('/api/categories');
      // Backend returns { status, data: Category[] }
      const list = Array.isArray(response.data?.data) ? response.data.data : [];
      return {
        status: response.data?.status || 'success',
        message: response.data?.message || 'OK',
        data: { categories: list },
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch categories',
        data: { categories: [] },
      };
    }
  },
};

// Posts API
export const postsApi = {
  getAll: async (page = 1, limit = 10, timestamp = ''): Promise<ApiResponse<{ posts: Post[], pagination: any, filters: any }>> => {
    try {
      const response = await apiClient.get(`/api/posts/all?page=${page}&limit=${limit}${timestamp}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch posts',
        data: { posts: [], pagination: {}, filters: {} },
      };
    }
  },

  getFollowing: async (page = 1, limit = 20, timestamp = ''): Promise<ApiResponse<{ posts: Post[], pagination: any, filters: any }>> => {
    try {
      const url = `/api/follows/posts?page=${page}&limit=${limit}${timestamp ? `&t=${timestamp}` : ''}`;
      const response = await apiClient.get(url);
      const apiResponse = response.data;
      
      // Log response for debugging
      if (__DEV__) {
        console.log('📥 [getFollowing] API Response:', {
          status: apiResponse?.status,
          hasData: !!apiResponse?.data,
          postsCount: apiResponse?.data?.posts?.length || 0,
          pagination: apiResponse?.data?.pagination,
        });
      }
      
      // Backend returns: { status: 'success', data: { posts: [...], pagination: {...}, filters: {...} } }
      if (apiResponse?.status === 'success' && apiResponse?.data) {
        const posts = apiResponse.data.posts || [];
        return {
          status: 'success',
          message: apiResponse.message || 'Following posts fetched successfully',
          data: {
            posts: posts,
            pagination: apiResponse.data.pagination || {
              currentPage: page,
              totalPages: posts.length > 0 ? Math.ceil((apiResponse.data.pagination?.totalCount || posts.length) / limit) : 0,
              totalCount: apiResponse.data.pagination?.totalCount || posts.length,
              hasNext: apiResponse.data.pagination?.hasNext || false,
              hasPrev: page > 1,
              limit: limit
            },
            filters: apiResponse.data.filters || {}
          }
        };
      }
      
      // Fallback structure mapping
      if (apiResponse?.data?.posts) {
        return apiResponse;
      }
      
      // Empty result - user follows no one or no posts
      return {
        status: 'success',
        message: 'No posts from following',
        data: { posts: [], pagination: {}, filters: {} },
      };
    } catch (error: any) {
      const { isNetworkError, getErrorMessage } = require('./utils/network-error-handler');
      
      const isNetwork = isNetworkError(error);
      const errorMessage = getErrorMessage(error, 'Failed to fetch following posts');
      
      // Handle network errors gracefully - return empty result instead of error
      if (isNetwork) {
        console.warn('⚠️ Network error fetching following posts:', errorMessage);
        // Return empty result for network errors so UI doesn't break
        return {
          status: 'success',
          message: 'Unable to load posts. Please check your connection.',
          data: { posts: [], pagination: {}, filters: {} },
        };
      }
      
      // Log non-network errors for debugging
      console.error('❌ Error fetching following posts:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
      });
      
      // Handle 404 or empty following list gracefully
      if (error.response?.status === 404 || error.response?.status === 400) {
        return {
          status: 'success',
          message: 'No posts from following',
          data: { posts: [], pagination: {}, filters: {} },
        };
      }
      
      // Handle 401 Unauthorized - user not logged in
      if (error.response?.status === 401) {
        return {
          status: 'error',
          message: 'Please log in to see posts from users you follow',
          data: { posts: [], pagination: {}, filters: {} },
        };
      }
      
      return {
        status: 'error',
        message: errorMessage,
        data: { posts: [], pagination: {}, filters: {} },
      };
    }
  },

  getFeatured: async (page = 1, limit = 10, timestamp = ''): Promise<ApiResponse<{ posts: Post[], pagination: any, filters: any }>> => {
    try {
      const response = await apiClient.get(`/api/featured?page=${page}&limit=${limit}${timestamp}`);
      const apiResponse = response.data;

      console.log('Raw featured API response:', JSON.stringify(apiResponse, null, 2));

      // Transform the response: API returns data.featuredPosts array where each item has a 'post' property
      // API structure: { status: "success", data: { featuredPosts: [...], pagination: {...} } }
      if (apiResponse?.status === 'success' && apiResponse?.data?.featuredPosts) {
        // Extract posts from featuredPosts array (each item.post contains the actual post)
        const featuredPosts = apiResponse.data.featuredPosts;
        const posts = featuredPosts.map((featuredItem: any) => {
          // Each featured item has a 'post' property containing the actual post data
          const post = featuredItem.post || featuredItem;
          return post;
        });

        console.log(`Transformed ${featuredPosts.length} featured posts to ${posts.length} posts`);

        return {
          status: 'success',
          message: apiResponse.message || 'Featured posts fetched successfully',
          data: {
            posts,
            pagination: apiResponse.data.pagination || {},
            filters: {}
          }
        };
      } else if (apiResponse?.featuredPosts) {
        // Handle alternative response structure (direct featuredPosts at root)
        const posts = apiResponse.featuredPosts.map((featuredItem: any) => featuredItem.post || featuredItem);
        return {
          status: 'success',
          message: 'Featured posts fetched successfully',
          data: {
            posts,
            pagination: apiResponse.pagination || {},
            filters: {}
          }
        };
      }

      // If response already has posts array, return as-is
      if (apiResponse?.data?.posts) {
        return apiResponse;
      }

      // Fallback: return empty posts
      console.warn('Unexpected featured posts response structure:', apiResponse);
      return {
        status: 'success',
        message: 'No featured posts found',
        data: { posts: [], pagination: {}, filters: {} },
      };
    } catch (error: any) {
      console.error('Featured posts API error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url
      });

      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch featured posts',
        data: { posts: [], pagination: {}, filters: {} },
      };
    }
  },

  getById: async (id: string): Promise<ApiResponse<Post>> => {
    try {
      // Include user and full details in the response
      const response = await apiClient.get(`/api/posts/${id}?include=user`);
      const apiResponse = response.data;

      // Backend returns: { status, data: { post: {...} } }
      if (apiResponse?.status === 'success' && apiResponse?.data) {
        const post = (apiResponse.data as any).post || apiResponse.data;
        return {
          status: 'success',
          message: apiResponse.message || 'Post fetched successfully',
          data: post as Post,
        };
      }

      return apiResponse;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch post',
        data: {} as Post,
      };
    }
  },

  create: async (data: FormData): Promise<ApiResponse<Post>> => {
    try {
      const response = await apiClient.post('/api/posts', data, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to create post',
        data: {} as Post,
      };
    }
  },

  like: async (postId: string): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.post(`/api/posts/${postId}/like`);
      return response.data;
    } catch (error: any) {
      console.error('Like API error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url
      });

      // If it's a network error or 404/500, return success for demo purposes
      if (error.code === 'ECONNREFUSED' || error.response?.status >= 400) {
        console.log('Using fallback like response');
        return {
          status: 'success',
          message: 'Post liked (demo mode)',
          data: { likeCount: Math.floor(Math.random() * 100) + 1 },
        };
      }

      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to like post',
        data: {},
      };
    }
  },

  unlike: async (postId: string): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.post(`/api/posts/${postId}/like`);
      return response.data;
    } catch (error: any) {
      console.error('Unlike API error details:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url
      });

      // If it's a network error or 404/500, return success for demo purposes
      if (error.code === 'ECONNREFUSED' || error.response?.status >= 400) {
        console.log('Using fallback unlike response');
        return {
          status: 'success',
          message: 'Post unliked (demo mode)',
          data: { likeCount: Math.floor(Math.random() * 50) },
        };
      }

      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to unlike post',
        data: {},
      };
    }
  },

  checkLikeStatus: async (postId: string): Promise<ApiResponse<{ isLiked: boolean; likeCount: number }>> => {
    try {
      const response = await apiClient.get(`/api/likes/posts/${postId}/status`);
      return {
        status: response.data.status,
        message: response.data.message,
        data: {
          isLiked: response.data.data?.isLiked || false,
          likeCount: response.data.data?.likeCount || 0,
        },
      };
    } catch (error: any) {
      console.error('Check like status error:', error.response?.data || error.message);
      return {
        status: 'error',
        message: 'Failed to check like status',
        data: { isLiked: false, likeCount: 0 },
      };
    }
  },

  getLikedPosts: async (): Promise<ApiResponse<{ posts: Post[] }>> => {
    try {
      const response = await apiClient.get('/api/posts/liked');
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch liked posts',
        data: { posts: [] },
      };
    }
  },

  search: async (query: string): Promise<ApiResponse<Post[]>> => {
    try {
      const response = await apiClient.get(`/api/posts/search?q=${encodeURIComponent(query)}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to search posts',
        data: [],
      };
    }
  },

  getComments: async (postId: string, page = 1, limit = 20): Promise<ApiResponse<{ comments: any[]; pagination?: any }>> => {
    try {
      const url = `/api/posts/${postId}/comments?page=${page}&limit=${limit}`;
      console.log('[API] Fetching comments from:', url);
      const response = await apiClient.get(url);
      console.log('[API] Comments response:', response.status);
      return response.data;
    } catch (error: any) {
      // Try alternative endpoint if first one fails
      if (error.message === 'Network Error' || error.code === 'NETWORK_ERROR' || error.code === 'ECONNABORTED') {
        console.log('[API] First comments endpoint failed, trying alternative...');
        try {
          const altUrl = `/api/posts/comments?postId=${postId}&page=${page}&limit=${limit}`;
          const response = await apiClient.get(altUrl);
          return response.data;
        } catch (altError: any) {
          console.error('[API] Alternative comments endpoint also failed:', altError.message);
        }
      }
      
      console.error('[API] Get comments error:', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
      
      // Return empty comments silently instead of showing error to user
      // Comments feature may not be fully implemented on backend yet
      console.log('[API] Comments feature unavailable, returning empty list');
      return {
        status: 'success',
        message: 'Comments not available',
        data: { comments: [], pagination: {} },
      };
    }
  },

  // Draft Posts API
  getDrafts: async (page = 1, limit = 20): Promise<ApiResponse<{ posts: Post[]; pagination: any }>> => {
    try {
      const response = await apiClient.get(`/api/posts/drafts?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch draft posts',
        data: { posts: [], pagination: {} },
      };
    }
  },

  publishDraft: async (postId: string): Promise<ApiResponse<{ post: Post }>> => {
    try {
      const response = await apiClient.put(`/api/posts/${postId}/publish`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to publish draft post',
        data: { post: {} as Post },
      };
    }
  },

  addComment: async (postId: string, content: string): Promise<ApiResponse<{ comment: any }>> => {
    try {
      // Validate content before sending
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return {
          status: 'error',
          message: 'Comment text is required',
          data: { comment: null },
        };
      }

      const trimmedContent = content.trim();

      // Explicitly set headers to avoid any ambiguity
      const response = await apiClient.post(
        `/api/posts/${postId}/comments`,
        { comment_text: trimmedContent },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('Add comment API error:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to add comment';

      return {
        status: 'error',
        message: errorMessage,
        data: { comment: null },
      };
    }
  },

  deleteComment: async (commentId: string): Promise<ApiResponse<null>> => {
    try {
      const response = await apiClient.delete(
        `/api/posts/comments/${commentId}`,
        {
          headers: {
            'Accept': 'application/json',
          }
        }
      );
      return response.data;
    } catch (error: any) {
      console.error('Delete comment API error:', error);
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to delete comment',
        data: null,
      };
    }
  },

  reportComment: async (commentId: string, reason: string, description?: string): Promise<ApiResponse<null>> => {
    try {
      const body: { reason: string; description?: string } = { reason };
      if (description) {
        body.description = description;
      }
      const response = await apiClient.post(`/api/posts/comments/${commentId}/report`, body);
      return response.data;
    } catch (error: any) {
      console.error('Report comment API error:', error);
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to report comment',
        data: null,
      };
    }
  },

  deletePost: async (postId: string) => {
    const response = await apiClient.delete(`/api/posts/${postId}`);
    return response.data;
  },
};

// User API
export const userApi = {
  getProfile: async (): Promise<ApiResponse<User>> => {
    try {
      const response = await apiClient.get('/api/user/profile');
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch profile',
        data: {} as User,
      };
    }
  },

  updateProfile: async (updateData: any, profileImage?: string): Promise<ApiResponse<User>> => {
    try {
      let response;

      if (profileImage) {
        // Create FormData for multipart upload
        const formData = new FormData();

        // Add phone numbers
        if (updateData.phone1) formData.append('phone1', updateData.phone1);
        if (updateData.phone2) formData.append('phone2', updateData.phone2);

        // Add profile image
        const imageUri = profileImage;
        const filename = imageUri.split('/').pop() || 'profile.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';

        formData.append('user_facial_image', {
          uri: imageUri,
          type,
          name: filename,
        } as any);

        response = await apiClient.put('/api/user/profile', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
      } else {
        // Send JSON data for phone numbers only
        response = await apiClient.put('/api/user/profile', updateData);
      }

      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to update profile',
        data: {} as User,
      };
    }
  },

  getUserById: async (id: string): Promise<ApiResponse<User>> => {
    try {
      const response = await apiClient.get(`/api/users/${id}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch user',
        data: {} as User,
      };
    }
  },

  getUserPosts: async (userId: string, page = 1, limit = 20, status = 'approved'): Promise<ApiResponse<any>> => {
    try {
      // Use the appropriate endpoint based on status
      let endpoint = `/api/users/${userId}/posts`;
      if (status === 'approved') {
        endpoint = `/api/users/${userId}/posts/approved`;
      }
      const response = await apiClient.get(`${endpoint}?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch user posts',
        data: { posts: [], pagination: {} },
      };
    }
  },

  getOwnPosts: async () => {
    const response = await apiClient.get('/api/posts/user');
    return response.data;
  },

  getUserApprovedPosts: async (userId: string, page = 1, limit = 10) => {
    try {
      const response = await apiClient.get(`/api/users/${userId}/posts/approved?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch user approved posts',
        data: [],
      };
    }
  },

  getSuggestions: async () => {
    try {
      // Try to get combined suggestions (mutual + discover)
      // First try the main endpoint, if it doesn't exist, combine mutual and discover
      try {
        const response = await apiClient.get('/api/users/suggestions');
        if (response.data && response.data.status === 'success') {
          return response.data;
        }
      } catch {
        // If main endpoint doesn't exist, combine mutual and discover
      }
      
      // Combine mutual and discover suggestions
      const [mutualRes, discoverRes] = await Promise.all([
        apiClient.get('/api/users/suggestions/mutual').catch(() => ({ data: { status: 'success', data: { suggestions: [] } } })),
        apiClient.get('/api/users/suggestions/discover').catch(() => ({ data: { status: 'success', data: { suggestions: [] } } }))
      ]);
      
      const mutual = mutualRes.data?.data?.suggestions || [];
      const discover = discoverRes.data?.data?.suggestions || [];
      
      // Combine and deduplicate by id
      const combined = [...mutual, ...discover];
      const unique = combined.filter((user, index, self) => 
        index === self.findIndex((u) => u.id === user.id)
      );
      
      return {
        status: 'success',
        data: { suggestions: unique },
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch user suggestions',
        data: { suggestions: [] },
      };
    }
  },

  search: async (query: string): Promise<ApiResponse<{ users: User[] }>> => {
    try {
      const response = await apiClient.get(`/api/users/search?q=${encodeURIComponent(query)}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to search users',
        data: { users: [] },
      };
    }
  },

  getStatistics: async (): Promise<ApiResponse<{ posts_count: number; followers_count: number; following_count: number; total_likes: number; total_views: number; engagement_rate: number; statistics?: any }>> => {
    try {
      const response = await apiClient.get('/api/user/statistics');
      const apiResponse = response.data;
      
      // Backend returns: { status: 'success', data: { statistics: {...} } } or { status: 'success', data: {...} }
      if (apiResponse?.status === 'success' && apiResponse?.data) {
        const stats = apiResponse.data.statistics || apiResponse.data;
        return {
          status: 'success',
          message: apiResponse.message || 'Statistics fetched successfully',
          data: {
            posts_count: stats.posts_count || 0,
            followers_count: stats.followers_count || 0,
            following_count: stats.following_count || 0, // Now properly returned from backend
            total_likes: stats.total_likes || 0,
            total_views: stats.total_views || stats.total_profile_views || 0,
            engagement_rate: stats.engagement_rate || 0,
            statistics: stats, // Include full stats object for flexibility
          },
        };
      }
      
      return {
        status: 'error',
        message: 'Failed to fetch statistics',
        data: { posts_count: 0, followers_count: 0, following_count: 0, total_likes: 0, total_views: 0, engagement_rate: 0 },
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: 'Failed to fetch statistics',
        data: { posts_count: 0, followers_count: 0, following_count: 0, total_likes: 0, total_views: 0, engagement_rate: 0 },
      };
    }
  },
};

// Notifications API - Matches NOTIFICATIONS.md spec
export const notificationsApi = {
  /**
   * Get all notifications for the authenticated user
   * GET /api/users/notifications
   */
  getAll: async (): Promise<ApiResponse<{ notifications: Notification[] }>> => {
    try {
      // Check if user is authenticated before making the request
      const token = await AsyncStorage.getItem('talynk_token');
      if (!token) {
        // Return empty notifications silently when not authenticated
        return {
          status: 'success',
          message: 'No notifications available',
          data: { notifications: [] },
        };
      }

      console.log('[Notifications API] 📥 GET /api/users/notifications');
      const response = await apiClient.get('/api/users/notifications');
      console.log('[Notifications API] ✅ Response received:', {
        status: response.data?.status,
        count: response.data?.data?.notifications?.length || 0,
      });
      return response.data;
    } catch (error: any) {
      // Only log errors if it's not a 401 (unauthorized) - that's expected when not logged in
      if (error.response?.status !== 401) {
        console.error('[Notifications API] ❌ Error fetching notifications:', {
          status: error.response?.status,
          message: error.response?.data?.message || error.message,
        });
      }
      // Return empty notifications silently for 401 errors (not authenticated)
      return {
        status: 'success',
        message: 'No notifications available',
        data: { notifications: [] },
      };
    }
  },

  /**
   * Toggle notification settings
   * PUT /api/users/notifications
   */
  toggleSettings: async (enabled: boolean): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.put('/api/users/notifications', { enabled });
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to update notification settings',
        data: {},
      };
    }
  },

  /**
   * Mark a single notification as read
   * PUT /api/users/notifications/:notificationId/read
   */
  markAsRead: async (notificationId: string): Promise<ApiResponse<{ notification: Notification }>> => {
    try {
      console.log('[Notifications API] 📝 PUT /api/users/notifications/' + notificationId + '/read');
      const response = await apiClient.put(`/api/users/notifications/${notificationId}/read`);
      console.log('[Notifications API] ✅ Mark as read response:', response.data?.status);
      return response.data;
    } catch (error: any) {
      console.error('[Notifications API] ❌ Error marking notification as read:', {
        notificationId,
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
      });
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to mark notification as read',
        data: { notification: {} as Notification },
      };
    }
  },

  /**
   * Mark all notifications as read
   * PUT /api/users/notifications/read-all
   */
  markAllAsRead: async (): Promise<ApiResponse<{ count?: number }>> => {
    try {
      console.log('[Notifications API] 📝 PUT /api/users/notifications/read-all');
      const response = await apiClient.put('/api/users/notifications/read-all');
      console.log('[Notifications API] ✅ Mark all as read response:', {
        status: response.data?.status,
        count: response.data?.data?.count,
      });
      return response.data;
    } catch (error: any) {
      console.error('[Notifications API] ❌ Error marking all as read:', {
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
      });
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to mark all notifications as read',
        data: { count: 0 },
      };
    }
  },

  delete: async (notificationId: string): Promise<ApiResponse<null>> => {
    try {
      console.log('[Notifications API] 🗑️ DELETE /api/users/notifications/' + notificationId);
      const response = await apiClient.delete(`/api/users/notifications/${notificationId}`);
      console.log('[Notifications API] ✅ Delete response:', response.data?.status);
      return response.data;
    } catch (error: any) {
      console.error('[Notifications API] ❌ Error deleting notification:', {
        notificationId,
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
      });
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to delete notification',
        data: null,
      };
    }
  },

  deleteAll: async (): Promise<ApiResponse<{ count?: number }>> => {
    try {
      console.log('[Notifications API] 🗑️ DELETE /api/users/notifications');
      const response = await apiClient.delete('/api/users/notifications');
      console.log('[Notifications API] ✅ Delete all response:', {
        status: response.data?.status,
        count: response.data?.data?.count,
      });
      return response.data;
    } catch (error: any) {
      console.error('[Notifications API] ❌ Error deleting all notifications:', {
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
      });
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to delete all notifications',
        data: { count: 0 },
      };
    }
  },
};

// Challenges API
export const challengesApi = {
  getAll: async (status = 'active'): Promise<ApiResponse<any>> => {
    try {
      // When fetching 'active' challenges, also include 'approved' status
      // because approved challenges should be treated as active
      let statusParam = status;
      if (status === 'active') {
        // Fetch both active and approved challenges
        // Handle errors gracefully - if one fails, still return the other
        let activeChallenges: any[] = [];
        let approvedChallenges: any[] = [];
        let pagination: any = {};
        
        try {
          const response = await apiClient.get(`/api/challenges?status=active`);
          const apiResponse = response.data;
          if (apiResponse?.status === 'success' && apiResponse?.data) {
            activeChallenges = Array.isArray(apiResponse.data) ? apiResponse.data : [];
            pagination = apiResponse.pagination || {};
          }
        } catch (error: any) {
          console.warn('⚠️ Error fetching active challenges:', error.message);
        }
        
        try {
          const approvedResponse = await apiClient.get(`/api/challenges?status=approved`);
          const approvedApiResponse = approvedResponse.data;
          if (approvedApiResponse?.status === 'success' && approvedApiResponse?.data) {
            approvedChallenges = Array.isArray(approvedApiResponse.data) ? approvedApiResponse.data : [];
            // Use approved pagination if active didn't have one
            if (!pagination || Object.keys(pagination).length === 0) {
              pagination = approvedApiResponse.pagination || {};
            }
          }
        } catch (error: any) {
          console.warn('⚠️ Error fetching approved challenges:', error.message);
        }
        
        // Combine and remove duplicates
        const allChallenges = [...activeChallenges, ...approvedChallenges];
        const uniqueChallenges = allChallenges.filter((challenge, index, self) =>
          index === self.findIndex((c) => c.id === challenge.id)
        );
        
        // Return success if we got any challenges, even if one request failed
        if (uniqueChallenges.length > 0 || (activeChallenges.length === 0 && approvedChallenges.length === 0)) {
          return {
            status: 'success',
            message: 'Challenges fetched successfully',
            data: {
              challenges: uniqueChallenges,
              pagination: pagination
            }
          };
        }
        
        // If both failed, return error
        return {
          status: 'error',
          message: 'Failed to fetch challenges',
          data: { challenges: [], pagination: {} },
        };
      }
      
      // For other statuses, fetch normally
      const response = await apiClient.get(`/api/challenges?status=${statusParam}`);
      const apiResponse = response.data;
      
      // Backend returns: { status: 'success', data: [...], pagination: {...} }
      if (apiResponse?.status === 'success' && apiResponse?.data) {
        const challenges = Array.isArray(apiResponse.data) ? apiResponse.data : [];
        return {
          status: 'success',
          message: apiResponse.message || 'Challenges fetched successfully',
          data: {
            challenges: challenges,
            pagination: apiResponse.pagination || {}
          }
        };
      }
      
      return {
        status: 'error',
        message: apiResponse?.message || 'Failed to fetch challenges',
        data: { challenges: [], pagination: {} },
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch challenges',
        data: { challenges: [], pagination: {} },
      };
    }
  },

  getMyChallenges: async (): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.get('/api/challenges/my-challenges');
      const apiResponse = response.data;
      
      // Backend returns: { status: 'success', data: [...], pagination: {...} }
      if (apiResponse?.status === 'success' && apiResponse?.data) {
        const challenges = Array.isArray(apiResponse.data) ? apiResponse.data : [];
        return {
          status: 'success',
          message: apiResponse.message || 'My challenges fetched successfully',
          data: {
            challenges: challenges,
            pagination: apiResponse.pagination || {}
          }
        };
      }
      
      return {
        status: 'error',
        message: apiResponse?.message || 'Failed to fetch my challenges',
        data: { challenges: [], pagination: {} },
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch my challenges',
        data: { challenges: [], pagination: {} },
      };
    }
  },

  getJoinedChallenges: async (): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.get('/api/challenges/joined');
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch joined challenges',
        data: [],
      };
    }
  },

  create: async (data: any): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.post('/api/challenges', data);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to create challenge',
        data: null,
      };
    }
  },

  join: async (challengeId: string): Promise<ApiResponse<any>> => {
    try {
      console.log('[API] Joining challenge:', challengeId);
      const response = await apiClient.post(`/api/challenges/${challengeId}/join`);
      console.log('[API] Join challenge response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('[API] Join challenge error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        challengeId
      });
      
      // Extract error message from various possible locations
      let errorMessage = 'Failed to join challenge';
      if (error.response?.data) {
        const errorData = error.response.data;
        errorMessage = errorData.message || errorData.error || errorMessage;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return {
        status: 'error',
        message: errorMessage,
        data: null,
      };
    }
  },

  getById: async (challengeId: string): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.get(`/api/challenges/${challengeId}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch challenge details',
        data: null,
      };
    }
  },

  getParticipants: async (challengeId: string): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.get(`/api/challenges/${challengeId}/participants`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch participants',
        data: [],
      };
    }
  },

  getPosts: async (challengeId: string, page = 1, limit = 20): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.get(`/api/challenges/${challengeId}/posts?page=${page}&limit=${limit}`);
      const apiResponse = response.data;
      
      // Backend returns: { status: 'success', data: [...], pagination: {...} }
      if (apiResponse?.status === 'success' && apiResponse?.data) {
        const posts = Array.isArray(apiResponse.data) ? apiResponse.data : [];
        // Extract post from challengePost wrapper if needed
        const normalizedPosts = posts.map((item: any) => item.post || item);
        
        return {
          status: 'success',
          message: apiResponse.message || 'Challenge posts fetched successfully',
          data: {
            posts: normalizedPosts,
            pagination: apiResponse.pagination || {}
          }
        };
      }
      
      return {
        status: 'error',
        message: apiResponse?.message || 'Failed to fetch challenge posts',
        data: { posts: [], pagination: {} },
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch challenge posts',
        data: { posts: [], pagination: {} },
      };
    }
  },

  createPost: async (challengeId: string, data: FormData): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.post(`/api/challenges/${challengeId}/posts`, data, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to create challenge post',
        data: null,
      };
    }
  },

  // Link existing post to a challenge
  addPostToChallenge: async (challengeId: string, postId: string): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.post(`/api/challenges/${challengeId}/posts/${postId}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to add post to challenge',
        data: null,
      };
    }
  }
};

// Follow API methods
export const followsApi = {
  // Follow a user - Backend expects { userId: string } in body
  follow: async (userId: string) => {
    try {
      const response = await apiClient.post('/api/follows', { userId });
      return response.data;
    } catch (error: any) {
      console.error('Follow API error:', error.response?.data || error.message);
      return {
        status: 'error',
        message: error.response?.data?.message || 'Cannot follow this user',
        data: {},
      };
    }
  },
  // Unfollow a user - Backend expects { userId: string } in body via DELETE
  unfollow: async (userId: string) => {
    try {
      // Backend route: DELETE /api/follows/:followingId
      const response = await apiClient.delete(`/api/follows/${userId}`, {
        data: { userId }
      });
      return response.data;
    } catch (error: any) {
      console.error('Unfollow API error:', error.response?.data || error.message);
      return {
        status: 'error',
        message: error.response?.data?.message || 'Cannot unfollow this user',
        data: {},
      };
    }
  },
  // Check if following
  checkFollowing: async (followingId: string) => {
    try {
      const response = await apiClient.get(`/api/follows/check/${followingId}`);
      return response.data;
    } catch (error: any) {
      console.error('Check following API error:', error.response?.data || error.message);
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to check follow status',
        data: { isFollowing: false },
      };
    }
  },
  // Get followers - returns { status: 'success', data: { followers: [...], hasMore: bool, totalCount: number } }
  getFollowers: async (userId: string, page = 1, limit = 20) => {
    try {
      const response = await apiClient.get(`/api/follows/users/${userId}/followers?page=${page}&limit=${limit}`);
      const apiResponse = response.data;
      
      // Backend structure: { status: 'success', data: { followers: [...], hasMore, totalCount } }
      if (apiResponse?.status === 'success' && apiResponse?.data) {
        return {
          status: 'success',
          message: apiResponse.message || 'Followers fetched successfully',
          data: {
            followers: apiResponse.data.followers || [],
            hasMore: apiResponse.data.hasMore || false,
            totalCount: apiResponse.data.totalCount || 0,
            pagination: {
              page,
              limit,
              hasMore: apiResponse.data.hasMore || false,
              total: apiResponse.data.totalCount || 0
            }
          }
        };
      }
      
      // Fallback
      return {
        status: 'success',
        message: 'No followers found',
        data: { followers: [], hasMore: false, totalCount: 0, pagination: {} }
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch followers',
        data: { followers: [], hasMore: false, totalCount: 0, pagination: {} },
      };
    }
  },
  // Get following - returns { status: 'success', data: { following: [...], hasMore: bool, totalCount: number } }
  getFollowingUsers: async (userId: string, page = 1, limit = 20) => {
    try {
      const response = await apiClient.get(`/api/follows/users/${userId}/following?page=${page}&limit=${limit}`);
      const apiResponse = response.data;
      
      // Backend structure: { status: 'success', data: { following: [...], hasMore, totalCount } }
      if (apiResponse?.status === 'success' && apiResponse?.data) {
        return {
          status: 'success',
          message: apiResponse.message || 'Following list fetched successfully',
          data: {
            following: apiResponse.data.following || [],
            hasMore: apiResponse.data.hasMore || false,
            totalCount: apiResponse.data.totalCount || 0,
            pagination: {
              page,
              limit,
              hasMore: apiResponse.data.hasMore || false,
              total: apiResponse.data.totalCount || 0
            }
          }
        };
      }
      
      // Fallback
      return {
        status: 'success',
        message: 'No following found',
        data: { following: [], hasMore: false, totalCount: 0, pagination: {} }
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch following',
        data: { following: [], hasMore: false, totalCount: 0, pagination: {} },
      };
    }
  },
};

// Likes API (per API_DOC)
export const likesApi = {
  toggle: async (postId: string): Promise<ApiResponse<{ isLiked: boolean; likeCount: number }>> => {
    try {
      const response = await apiClient.post(`/api/likes/posts/${postId}/toggle`);
      return {
        status: response.data.status,
        message: response.data.message,
        data: {
          isLiked: response.data.data?.isLiked || false,
          likeCount: response.data.data?.likeCount || 0,
        },
      };
    } catch (error: any) {
      const status = error.response?.status;
      const errorMessage = error.response?.data?.message || error.message || 'Failed to toggle like';

      // Handle 404 (Post not found) gracefully - don't log as error
      if (status === 404) {
        console.warn('Post not found for like toggle:', postId);
        return {
          status: 'error',
          message: 'Post not found',
          data: { isLiked: false, likeCount: 0 },
        } as any;
      }

      // Handle network errors gracefully
      if (error.code === 'NETWORK_ERROR' || error.message?.includes('Network')) {
        console.warn('Network error during like toggle:', postId);
        return {
          status: 'error',
          message: 'Network error. Please check your connection.',
          data: { isLiked: false, likeCount: 0 },
        } as any;
      }

      // Log other errors
      console.error('Toggle like API error:', {
        message: errorMessage,
        status: status,
        data: error.response?.data,
        url: error.config?.url,
        postId
      });

      return {
        status: 'error',
        message: errorMessage,
        data: { isLiked: false, likeCount: 0 },
      } as any;
    }
  },

  getStatus: async (postId: string): Promise<ApiResponse<{ isLiked: boolean; likeCount: number }>> => {
    try {
      const response = await apiClient.get(`/api/likes/posts/${postId}/status`);
      return {
        status: response.data.status,
        message: response.data.message,
        data: {
          isLiked: response.data.data?.isLiked || false,
          likeCount: response.data.data?.likeCount || 0,
        },
      };
    } catch (error: any) {
      const status = error.response?.status;
      const errorMessage = error.response?.data?.message || error.message || 'Failed to get like status';

      // Handle 404 (Post not found) gracefully - don't log as error
      if (status === 404) {
        console.warn('Post not found for like status check:', postId);
        return {
          status: 'error',
          message: 'Post not found',
          data: { isLiked: false, likeCount: 0 },
        } as any;
      }

      // Handle network errors gracefully
      if (error.code === 'NETWORK_ERROR' || error.message?.includes('Network')) {
        console.warn('Network error during like status check:', postId);
        return {
          status: 'error',
          message: 'Network error. Please check your connection.',
          data: { isLiked: false, likeCount: 0 },
        } as any;
      }

      console.error('Get like status API error:', error);
      return {
        status: 'error',
        message: errorMessage,
        data: { isLiked: false, likeCount: 0 },
      } as any;
    }
  },

  batchCheckStatus: async (postIds: string[]): Promise<ApiResponse<Record<string, { isLiked: boolean; likeCount: number }>>> => {
    try {
      if (!Array.isArray(postIds) || postIds.length === 0) {
        return {
          status: 'error',
          message: 'postIds must be a non-empty array',
          data: {},
        };
      }

      // Limit to 100 posts per batch (as per backend constraint)
      const batchIds = postIds.slice(0, 100);

      const response = await apiClient.post('/api/likes/posts/batch-status', {
        postIds: batchIds,
      });

      return {
        status: response.data.status,
        message: response.data.message,
        data: response.data.data || {},
      };
    } catch (error: any) {
      const { isNetworkError, getErrorMessage } = require('./utils/network-error-handler');
      
      const isNetwork = isNetworkError(error);
      const errorMessage = getErrorMessage(error, 'Failed to check like statuses');
      
      if (isNetwork) {
        console.warn('⚠️ Network error checking like status:', errorMessage);
        // Return empty data for network errors - UI will work with cached/default values
        return {
          status: 'error',
          message: errorMessage,
          data: {},
        };
      } else {
        console.error('❌ Batch check like status API error:', error);
        return {
          status: 'error',
          message: errorMessage,
          data: {},
        };
      }
    }
  },

  getLikers: async (postId: string, page: number = 1, limit: number = 50): Promise<ApiResponse<{ users: User[]; pagination: any; post: { id: string; totalLikes: number } }>> => {
    try {
      const response = await apiClient.get(`/api/likes/posts/${postId}/users?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch likers',
        data: { users: [], pagination: {}, post: { id: postId, totalLikes: 0 } },
      };
    }
  },
};

// Search API
export const searchApi = {
  search: async (
    query: string,
    options?: {
      type?: 'all' | 'posts' | 'users' | 'challenges';
      country_id?: number;
      category_id?: number;
      start_date?: string;
      end_date?: string;
      status?: string;
      challenge_status?: string;
      page?: number;
      limit?: number;
      sort?: 'relevance' | 'newest' | 'oldest' | 'most_liked' | 'most_viewed';
    }
  ): Promise<ApiResponse<{ posts: Post[]; users: User[]; challenges: any[]; pagination: any; filters: any }>> => {
    try {
      const params = new URLSearchParams();
      params.append('q', query);
      
      if (options?.type) params.append('type', options.type);
      if (options?.country_id) params.append('country_id', String(options.country_id));
      if (options?.category_id) params.append('category_id', String(options.category_id));
      if (options?.start_date) params.append('start_date', options.start_date);
      if (options?.end_date) params.append('end_date', options.end_date);
      if (options?.status) params.append('status', options.status);
      if (options?.challenge_status) params.append('challenge_status', options.challenge_status);
      if (options?.page) params.append('page', String(options.page));
      if (options?.limit) params.append('limit', String(options.limit));
      if (options?.sort) params.append('sort', options.sort);
      
      const response = await apiClient.get(`/api/search?${params.toString()}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to search',
        data: { posts: [], users: [], challenges: [], pagination: {}, filters: {} },
      };
    }
  },
};

// Views API
export const viewsApi = {
  recordView: async (postId: string, watchTime: number, visibilityPercent: number, sessionId?: string): Promise<ApiResponse<{ viewRecorded: boolean; viewCount: number }>> => {
    try {
      const response = await apiClient.post(`/api/views/posts/${postId}`, {
        sessionId,
        watchTime,
        visibilityPercent,
      });
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to record view',
        data: { viewRecorded: false, viewCount: 0 },
      };
    }
  },

  getViewStats: async (postId: string): Promise<ApiResponse<{ totalViews: number; uniqueUserViews: number; anonymousViews: number; recentViews: any[] }>> => {
    try {
      const response = await apiClient.get(`/api/views/posts/${postId}/stats`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch view stats',
        data: { totalViews: 0, uniqueUserViews: 0, anonymousViews: 0, recentViews: [] },
      };
    }
  },

  getViewMilestones: async (postId: string): Promise<ApiResponse<{ currentViews: number; reachedMilestones: number[]; nextMilestone: number | null; progressToNext: string }>> => {
    try {
      const response = await apiClient.get(`/api/views/posts/${postId}/milestones`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch milestones',
        data: { currentViews: 0, reachedMilestones: [], nextMilestone: null, progressToNext: '0' },
      };
    }
  },

  getTrending: async (period: '1h' | '24h' | '7d' | '30d' = '24h', limit: number = 20): Promise<ApiResponse<{ posts: Post[]; period: string; generatedAt: string }>> => {
    try {
      const response = await apiClient.get(`/api/views/trending?period=${period}&limit=${limit}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch trending posts',
        data: { posts: [], period, generatedAt: new Date().toISOString() },
      };
    }
  },
};

// Reports API - Complete implementation per NOTIFICATIONS&REPORTING.md
export const reportsApi = {
  /**
   * Report a post
   * POST /api/reports/posts/:postId
   */
  reportPost: async (postId: string, reason: string, description?: string): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.post(`/api/reports/posts/${postId}`, {
        reason,
        description: description || null,
      });
      return response.data;
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.data?.message ||
        error.response?.data?.message ||
        error.message ||
        'Failed to report post';

      const isAlreadyReported = errorMessage.toLowerCase().includes('already reported');

      return {
        status: 'error',
        message: errorMessage,
        data: {
          alreadyReported: isAlreadyReported,
        },
      };
    }
  },

  /**
   * Get reports for a specific post
   * GET /api/reports/posts/:postId
   */
  getPostReports: async (postId: string): Promise<ApiResponse<{ reports: any[] }>> => {
    try {
      const response = await apiClient.get(`/api/reports/posts/${postId}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch post reports',
        data: { reports: [] },
      };
    }
  },

  /**
   * Appeal a flagged post
   * POST /api/reports/posts/:postId/appeal
   */
  appealPost: async (postId: string, appealReason: string, additionalInfo?: string): Promise<ApiResponse<any>> => {
    try {
      const response = await apiClient.post(`/api/reports/posts/${postId}/appeal`, {
        appealReason,
        additionalInfo: additionalInfo || null,
      });
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to submit appeal',
        data: {},
      };
    }
  },

  /**
   * Get user's appeals
   * GET /api/reports/appeals/my?page=1&limit=10
   */
  getMyAppeals: async (page = 1, limit = 10): Promise<ApiResponse<{ appeals: any[]; pagination?: any }>> => {
    try {
      const response = await apiClient.get(`/api/reports/appeals/my?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error: any) {
      return {
        status: 'error',
        message: error.response?.data?.message || 'Failed to fetch appeals',
        data: { appeals: [], pagination: {} },
      };
    }
  },
};
