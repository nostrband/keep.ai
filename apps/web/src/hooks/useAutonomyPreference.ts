import { useState, useEffect, useCallback } from 'react';
import { useDbQuery } from './dbQuery';

export type AutonomyMode = 'ai_decides' | 'coordinate';

const STORAGE_KEY = 'keep-ai-autonomy-preference';

/**
 * Hook to manage user's autonomy preference.
 *
 * - "ai_decides": Agent minimizes questions and uses safe defaults
 * - "coordinate": Agent asks more clarifying questions before proceeding
 *
 * The preference is persisted in both localStorage (for immediate UI response)
 * and the backend database (for agent to access during task execution).
 */
export function useAutonomyPreference() {
  const { api } = useDbQuery();
  const [mode, setModeState] = useState<AutonomyMode>('ai_decides');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preference from localStorage on mount, then sync with backend
  useEffect(() => {
    let localMode: AutonomyMode = 'ai_decides';

    // Load from localStorage first for immediate UI
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'coordinate' || stored === 'ai_decides') {
        localMode = stored;
        setModeState(stored);
      }
    } catch (error) {
      console.warn('Could not load autonomy preference from localStorage:', error);
    }

    // Sync localStorage preference to backend when API becomes available
    if (api) {
      api.setAutonomyMode(localMode).catch((error) => {
        console.warn('Could not sync autonomy preference to backend:', error);
      });
    }

    setIsLoaded(true);
  }, [api]);

  // Update preference and persist to both localStorage and backend
  const setMode = useCallback((newMode: AutonomyMode) => {
    setModeState(newMode);

    // Persist to localStorage for immediate UI on refresh
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch (error) {
      console.warn('Could not save autonomy preference to localStorage:', error);
    }

    // Persist to backend for agent to access
    if (api) {
      api.setAutonomyMode(newMode).catch((error) => {
        console.warn('Could not save autonomy preference to backend:', error);
      });
    }
  }, [api]);

  // Toggle between modes
  const toggleMode = useCallback(() => {
    const newMode = mode === 'ai_decides' ? 'coordinate' : 'ai_decides';
    setMode(newMode);
  }, [mode, setMode]);

  return {
    mode,
    setMode,
    toggleMode,
    isLoaded,
    isAiDecides: mode === 'ai_decides',
    isCoordinate: mode === 'coordinate',
  };
}

/**
 * Get the autonomy preference directly from localStorage.
 * Useful for non-React contexts where hooks can't be used.
 */
export function getAutonomyPreference(): AutonomyMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'coordinate') {
      return 'coordinate';
    }
  } catch {
    // Ignore errors
  }
  return 'ai_decides';
}
