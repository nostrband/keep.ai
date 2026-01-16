import { useState, useEffect, useCallback } from 'react';

export type AutonomyMode = 'ai_decides' | 'coordinate';

const STORAGE_KEY = 'keep-ai-autonomy-preference';

/**
 * Hook to manage user's autonomy preference.
 *
 * - "ai_decides": Agent minimizes questions and uses safe defaults
 * - "coordinate": Agent asks more clarifying questions before proceeding
 *
 * The preference is persisted in localStorage.
 */
export function useAutonomyPreference() {
  const [mode, setModeState] = useState<AutonomyMode>('ai_decides');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preference from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'coordinate' || stored === 'ai_decides') {
        setModeState(stored);
      }
    } catch (error) {
      // localStorage might not be available
      console.warn('Could not load autonomy preference:', error);
    }
    setIsLoaded(true);
  }, []);

  // Update preference and persist to localStorage
  const setMode = useCallback((newMode: AutonomyMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch (error) {
      console.warn('Could not save autonomy preference:', error);
    }
  }, []);

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
 * Useful for server-side or non-React contexts.
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
