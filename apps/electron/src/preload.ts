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

  // Remove all listeners for a channel
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Remove a specific listener for a channel
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
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
  // Returns unsubscribe function to remove only this listener
  onNavigateTo: (callback: (path: string) => void) => {
    const handler = (_event: unknown, path: string) => callback(path);
    ipcRenderer.on('navigate-to', handler);
    return () => ipcRenderer.removeListener('navigate-to', handler);
  },

  // Listen for focus-input message from tray menu "New automation..." [Spec 01]
  // Returns unsubscribe function to remove only this listener
  onFocusInput: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('focus-input', handler);
    return () => ipcRenderer.removeListener('focus-input', handler);
  },

  // Listen for pause-all-automations message from tray menu [Spec 11]
  // Returns unsubscribe function to remove only this listener
  onPauseAllAutomations: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('pause-all-automations', handler);
    return () => ipcRenderer.removeListener('pause-all-automations', handler);
  },
});

// Custom logging for development
console.log('Preload script loaded successfully');