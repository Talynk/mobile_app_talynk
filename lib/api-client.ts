import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from './config';
import { authEventEmitter } from './auth-event-emitter';
import { isNetworkError } from './utils/network-error-handler';
import { networkStatus } from './network-status';

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
      // Silently handle token retrieval errors
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
    // Any successful response implies we have connectivity
    networkStatus.reportOnline({ source: 'api-client' });
    return response;
  },
  async (error: AxiosError) => {
    // Handle 401 Unauthorized
    if (error.response?.status === 401) {
      // Token expired, clear storage and notify auth context
      try {
        await AsyncStorage.removeItem('talynk_token');
        await AsyncStorage.removeItem('talynk_user');
        // Emit event so auth context can update state
        authEventEmitter.emitUnauthorized();
      } catch (storageError) {
        // Silently handle storage errors
      }
    }
    
    // Handle network errors - silently handle, no console logs
    if (isNetworkError(error)) {
      networkStatus.reportOffline({
        source: 'api-client',
        message: `${error.config?.method || 'request'} ${error.config?.url || ''}`.trim(),
      });
    }
    
    return Promise.reject(error);
  }
);

export default apiClient; 