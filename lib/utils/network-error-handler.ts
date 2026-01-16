import { AxiosError } from 'axios';
import { Alert } from 'react-native';

/**
 * Checks if an error is a network error
 */
export const isNetworkError = (error: any): boolean => {
  if (!error) return false;
  
  // Axios network errors
  if (error.code === 'NETWORK_ERROR' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return true;
  }
  
  // Error message patterns
  const message = error.message || '';
  if (
    message.includes('Network Error') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('Failed to fetch')
  ) {
    return true;
  }
  
  // No response usually means network error
  if (!error.response && error.request) {
    return true;
  }
  
  return false;
};

/**
 * Gets a user-friendly error message from an error
 */
export const getErrorMessage = (error: any, defaultMessage: string = 'An error occurred'): string => {
  if (isNetworkError(error)) {
    return 'No internet connection. Please check your network and try again.';
  }
  
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  
  if (error.message) {
    return error.message;
  }
  
  return defaultMessage;
};

/**
 * Shows a user-friendly error alert
 */
export const showNetworkError = (error: any, title: string = 'Connection Error'): void => {
  const message = getErrorMessage(error);
  Alert.alert(title, message, [{ text: 'OK' }]);
};

/**
 * Checks if device is likely offline
 */
export const isOffline = (error: any): boolean => {
  return isNetworkError(error) && !error.response;
};

/**
 * Gets retry delay based on attempt number (exponential backoff)
 */
export const getRetryDelay = (attempt: number): number => {
  return Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
};
