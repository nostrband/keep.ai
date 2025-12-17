// TypeScript declaration for Electron API
declare global {
  interface Window {
    appApi: {
      openExternal: (url: string) => void;
    };
  }
}

/**
 * Opens a URL in the appropriate way depending on the environment.
 * In Electron, uses the secure openExternal API.
 * In browser, uses standard window.open with security attributes.
 */
export function openUrl(url: string) {
  // Electron renderer with preload
  if (typeof window !== 'undefined' && (window as any).appApi?.openExternal) {
    (window as any).appApi.openExternal(url);
  } else {
    // Standard browser environment
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}