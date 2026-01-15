// Backend server configuration is now handled in server.ts

// Clerk publishable key - should be configured for authentication
export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// JWT token storage key in localStorage
export const JWT_TOKEN_KEY = 'keep_ai_jwt_token';

// API endpoints
export const API_ENDPOINTS = {
  GET_USER_PROFILE: '/api/user/profile',
  GET_API_KEY: '/api/v1/api-key',
  VERIFY_TOKEN: '/api/auth/verify',
} as const;

// Authentication states
export const AUTH_STATES = {
  LOADING: 'loading',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
  ADVANCED_MODE: 'advanced_mode',
} as const;

export type AuthState = typeof AUTH_STATES[keyof typeof AUTH_STATES];