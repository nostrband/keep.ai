import { useState, useEffect, useCallback } from 'react';
import { useDbQuery } from './dbQuery';

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
 */
export function useNeedAuth() {
  const { api, dbStatus } = useDbQuery();
  const [state, setState] = useState<NeedAuthState>({ needed: false });
  const [isLoaded, setIsLoaded] = useState(false);

  // Load state from database
  const loadState = useCallback(async () => {
    if (!api || dbStatus !== 'ready') return;

    try {
      const needAuthState = await api.getNeedAuth();
      setState(needAuthState);
      setIsLoaded(true);
    } catch (error) {
      console.warn('Could not load needAuth state from database:', error);
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
    } catch (error) {
      console.warn('Could not clear needAuth flag:', error);
    }
  }, [api]);

  return {
    needAuth: state.needed,
    reason: state.reason,
    timestamp: state.timestamp,
    isLoaded,
    clearNeedAuth,
    refresh: loadState,
  };
}
