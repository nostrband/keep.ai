/// <reference types="vite/client" />

declare const __FLAVOR__: string;
declare const __FRONTEND__: boolean;
declare const __SERVERLESS__: boolean;
declare const __ELECTRON__: boolean;

interface ImportMetaEnv {
  readonly VITE_FLAVOR: string;
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Electron API exposed from preload script
interface ElectronAPI {
  getVersion: () => Promise<string>;
  getPlatform: () => string;
  removeAllListeners: (channel: string) => void;
  showNotification: (options: {
    title: string;
    body: string;
    workflowId?: string;
  }) => Promise<void>;
  updateTrayBadge: (count: number) => Promise<void>;
  onNavigateTo: (callback: (path: string) => void) => void;
  onFocusInput: (callback: () => void) => void;
  onPauseAllAutomations: (callback: () => void) => void;
}

// Extend Window interface with Electron API
interface Window {
  electronAPI?: ElectronAPI;
}