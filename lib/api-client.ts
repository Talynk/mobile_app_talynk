import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from './config';
import { authEventEmitter } from './auth-event-emitter';
import { isNetworkError } from './utils/network-error-handler';

// Create axios instance
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem('talynk_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Error getting token from storage:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError) => {
    // Handle 401 Unauthorized
    if (error.response?.status === 401) {
      // Token expired, clear storage and notify auth context
      console.warn('[API] 401 Unauthorized - clearing auth state');
      try {
        await AsyncStorage.removeItem('talynk_token');
        await AsyncStorage.removeItem('talynk_user');
        // Emit event so auth context can update state
        authEventEmitter.emitUnauthorized();
      } catch (storageError) {
        console.error('[API] Error clearing storage:', storageError);
      }
    }
    
    // Handle network errors - log but don't show alert here (let UI handle it)
    if (isNetworkError(error)) {
      console.warn('[API] Network error:', {
        url: error.config?.url,
        method: error.config?.method,
        message: error.message,
      });
    }
    
    return Promise.reject(error);
  }
);

export default apiClient; 