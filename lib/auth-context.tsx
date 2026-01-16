import React, { createContext, useContext, useReducer, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthState, User } from '../types';
import { authApi } from './api';
import { authEventEmitter } from './auth-event-emitter';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<boolean>;
  register: (data: any) => Promise<boolean>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_USER'; payload: User }
  | { type: 'SET_TOKEN'; payload: string }
  | { type: 'LOGOUT' }
  | { type: 'SET_AUTHENTICATED'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const authReducer = (state: AuthState & { error: string | null }, action: AuthAction): AuthState & { error: string | null } => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_USER':
      return { ...state, user: action.payload, isAuthenticated: true };
    case 'SET_TOKEN':
      return { ...state, token: action.payload };
    case 'LOGOUT':
      return { ...state, user: null, token: null, isAuthenticated: false, error: null };
    case 'SET_AUTHENTICATED':
      return { ...state, isAuthenticated: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
};

const initialState: AuthState & { error: string | null } = {
  isAuthenticated: false,
  user: null,
  token: null,
  loading: true,
  error: null,
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  // Listen for unauthorized events (401 from API client)
  useEffect(() => {
    const handleUnauthorized = () => {
      console.log('[Auth] Received unauthorized event, logging out');
      dispatch({ type: 'LOGOUT' });
    };

    authEventEmitter.onUnauthorized(handleUnauthorized);

    return () => {
      authEventEmitter.offUnauthorized(handleUnauthorized);
    };
  }, []);

  const loadStoredAuth = async () => {
    try {
      const [token, userData] = await Promise.all([
        AsyncStorage.getItem('talynk_token'),
        AsyncStorage.getItem('talynk_user'),
      ]);

      if (token && userData) {
        const user = JSON.parse(userData);
        dispatch({ type: 'SET_TOKEN', payload: token });
        dispatch({ type: 'SET_USER', payload: user });
      }
    } catch (error) {
      console.error('Error loading stored auth:', error);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    try {
      const response = await authApi.login(email, password);
      
      console.log('Login response:', JSON.stringify(response, null, 2));
      
      if (response.status === 'success' && response.data) {
        const accessToken = response.data.accessToken;
        const user = response.data.user || response.data;
        
        if (!accessToken) {
          console.error('No access token in response:', response.data);
          dispatch({ type: 'SET_ERROR', payload: 'Invalid response from server' });
          return false;
        }
        
        await Promise.all([
          AsyncStorage.setItem('talynk_token', accessToken),
          AsyncStorage.setItem('talynk_user', JSON.stringify(user)),
        ]);

        dispatch({ type: 'SET_TOKEN', payload: accessToken });
        dispatch({ type: 'SET_USER', payload: user });
        return true;
      } else {
        // Extract user-friendly error message
        let errorMessage = response.message || 'Login failed. Please try again.';
        
        // Handle specific error cases
        if (errorMessage.includes('Invalid credentials') || errorMessage.includes('401')) {
          errorMessage = 'Invalid credentials';
        } else if (errorMessage.includes('Network') || errorMessage.includes('timeout')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else if (errorMessage.includes('500') || errorMessage.includes('Server')) {
          errorMessage = 'Server error. Please try again later.';
        }
        
        console.error('Login failed:', errorMessage);
        dispatch({ type: 'SET_ERROR', payload: errorMessage });
        return false;
      }
    } catch (error: any) {
      console.error('Login error:', error);
      
      // Extract error message from various error formats
      let errorMessage = 'Login failed. Please try again.';
      
      if (error?.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      // Handle specific error cases
      if (errorMessage.includes('Invalid credentials') || errorMessage.includes('401')) {
        errorMessage = 'Invalid credentials';
      } else if (errorMessage.includes('Network') || errorMessage.includes('timeout')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      }
      
      dispatch({ type: 'SET_ERROR', payload: errorMessage });
      return false;
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const register = async (data: any): Promise<boolean> => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    try {
      const response = await authApi.register(data);
      console.log('Registration response:', JSON.stringify(response, null, 2));
      if (response.status === 'success') {
        // Registration succeeded, do NOT expect accessToken
        return true;
      } else {
        console.error('Registration failed:', response.message);
        dispatch({ type: 'SET_ERROR', payload: response.message });
        return false;
      }
    } catch (error) {
      console.error('Registration error:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Registration failed. Please try again.' });
      return false;
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const logout = async () => {
    try {
      await Promise.all([
        AsyncStorage.removeItem('talynk_token'),
        AsyncStorage.removeItem('talynk_user'),
      ]);
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
    dispatch({ type: 'LOGOUT' });
  };

  const refreshToken = async () => {
    try {
      const refreshToken = await AsyncStorage.getItem('talynk_refresh_token');
      if (refreshToken) {
        const response = await authApi.refresh(refreshToken);
        if (response.status === 'success') {
          await AsyncStorage.setItem('talynk_token', response.data.accessToken);
          dispatch({ type: 'SET_TOKEN', payload: response.data.accessToken });
        }
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      logout();
    }
  };

  const clearError = () => {
    dispatch({ type: 'SET_ERROR', payload: null });
  };

  const value: AuthContextType = {
    ...state,
    login,
    register,
    logout,
    refreshToken,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 