import { useState, useEffect } from "react";
import { API_ENDPOINT } from "../const";

interface ConfigState {
  isConfigValid: boolean | null; // null = loading, boolean = result
  isLoading: boolean;
  error: string | null;
}

export function useConfig() {
  const [state, setState] = useState<ConfigState>({
    isConfigValid: null,
    isLoading: true,
    error: null,
  });

  const checkConfig = async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await fetch(`${API_ENDPOINT}/check_config`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setState({
        isConfigValid: data.ok === true,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setState({
        isConfigValid: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to check configuration',
      });
    }
  };

  useEffect(() => {
    checkConfig();
  }, []);

  return {
    ...state,
    recheckConfig: checkConfig,
  };
}