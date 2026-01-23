import { useState, useEffect, useCallback } from 'react';
import { useDbQuery } from './dbQuery';
import { API_ENDPOINT } from '../const';

export interface NeedAuthState {
  needed: boolean;
  reason?: string;
  timestamp?: string;
}

/**
 * Hook to check if authentication is required.
 *
 * When needAuth is true, the task/workflow schedulers are paused and
 * the user needs to authenticate (sign in or provide API key) to continue.
 *
 * Reasons:
 * - "api_key_missing": No API key configured
 * - "auth_error": LLM returned auth error (401/403)
 * - "payment_required": LLM returned payment required (402)
 *
 * This hook proactively checks both:
 * 1. Database `need_auth` flag (set when LLM returns auth/payment errors)
 * 2. Config validity via `/check_config` endpoint (API key presence)
 */
export function useNeedAuth() {
  const { api, dbStatus } = useDbQuery();
  const [state, setState] = useState<NeedAuthState>({ needed: false });
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load state from database and check config
  const loadState = useCallback(async () => {
    if (!api || dbStatus !== 'ready') return;

    try {
      // Check database flag (reactive - set when LLM returns errors)
      const needAuthState = await api.getNeedAuth();

      // Also check config to detect missing API key proactively
      const configResponse = await fetch(`${API_ENDPOINT}/check_config`);
      const configData = await configResponse.json();

      // Determine if auth is needed:
      // - Database flag says so (auth/payment error occurred), OR
      // - Config is invalid (API key missing)
      const authNeeded = needAuthState.needed || configData.ok === false;

      // Determine reason (prefer database reason if available)
      let reason = needAuthState.reason;
      if (!reason && configData.ok === false) {
        reason = 'api_key_missing';
      }

      // Determine if first launch:
      // - Both API key AND base URL are empty (never configured)
      const firstLaunch = !configData.hasApiKey && !configData.hasBaseUrl;

      setState({
        needed: authNeeded,
        reason,
        timestamp: needAuthState.timestamp,
      });
      setIsFirstLaunch(firstLaunch);
      setIsLoaded(true);
    } catch (error) {
      console.warn('Could not load needAuth state:', error);
      setIsLoaded(true);
    }
  }, [api, dbStatus]);

  // Load on mount and when database changes
  useEffect(() => {
    loadState();
  }, [loadState]);

  // Refresh periodically to catch changes from server
  useEffect(() => {
    if (!api || dbStatus !== 'ready') return;

    const interval = setInterval(loadState, 5000);
    return () => clearInterval(interval);
  }, [api, dbStatus, loadState]);

  // Clear the needAuth flag (called after successful authentication)
  const clearNeedAuth = useCallback(async () => {
    if (!api) return;

    try {
      await api.setNeedAuth(false);
      setState({ needed: false });
      setIsFirstLaunch(false);
    } catch (error) {
      console.warn('Could not clear needAuth flag:', error);
    }
  }, [api]);

  return {
    needAuth: state.needed,
    reason: state.reason,
    timestamp: state.timestamp,
    isFirstLaunch,
    isLoaded,
    clearNeedAuth,
    refresh: loadState,
  };
}
