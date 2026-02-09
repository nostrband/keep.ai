import { useState, useEffect, useCallback } from 'react';
import { useDbQuery } from './dbQuery';
import { AutonomyMode } from '@app/proto';

/**
 * Hook to manage user's autonomy preference.
 *
 * - "ai_decides": Agent minimizes questions and uses safe defaults
 * - "coordinate": Agent asks more clarifying questions before proceeding
 *
 * The preference is persisted in the backend database via API.
 */
export function useAutonomyPreference() {
  const { api, dbStatus } = useDbQuery();
  const [mode, setModeState] = useState<AutonomyMode>('coordinate');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preference from database on mount
  useEffect(() => {
    if (!api || dbStatus !== 'ready') return;

    api.getAutonomyMode()
      .then((dbMode) => {
        setModeState(dbMode);
        setIsLoaded(true);
      })
      .catch((error) => {
        console.warn('Could not load autonomy preference from database:', error);
        setIsLoaded(true); // Still mark as loaded with default value
      });
  }, [api, dbStatus]);

  // Update preference and persist to database
  const setMode = useCallback((newMode: AutonomyMode) => {
    setModeState(newMode);

    if (api) {
      api.setAutonomyMode(newMode).catch((error) => {
        console.warn('Could not save autonomy preference to database:', error);
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
