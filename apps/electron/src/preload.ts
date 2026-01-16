// Preload script - runs in the renderer process but has access to Node.js APIs
// This script is executed before the web page is loaded and provides a secure 
// bridge between the main process and renderer process

const { contextBridge, ipcRenderer } = require('electron');

// Expose environment variables for SPA
contextBridge.exposeInMainWorld('env', {
  API_ENDPOINT: process.env.API_ENDPOINT,
  NODE_ENV: process.env.NODE_ENV,
});

// Expose the openExternal API for proper URL handling
contextBridge.exposeInMainWorld('appApi', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
});

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {

  // Get app version
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Platform information
  getPlatform: () => process.platform,

  // Remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // OS-level notifications for workflow errors [Spec 09]
  showNotification: (options: {
    title: string;
    body: string;
    workflowId?: string;
  }) => ipcRenderer.invoke('show-notification', options),

  // Tray badge for attention items [Spec 00, 09]
  updateTrayBadge: (count: number) => ipcRenderer.invoke('update-tray-badge', count),

  // Listen for navigation from notification clicks
  onNavigateTo: (callback: (path: string) => void) => {
    ipcRenderer.on('navigate-to', (_event: any, path: string) => callback(path));
  },
});

// Custom logging for development
console.log('Preload script loaded successfully');