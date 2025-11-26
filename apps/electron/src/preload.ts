// Preload script - runs in the renderer process but has access to Node.js APIs
// This script is executed before the web page is loaded and provides a secure 
// bridge between the main process and renderer process

const { contextBridge, ipcRenderer } = require('electron');

// Expose environment variables for SPA
contextBridge.exposeInMainWorld('env', {
  API_ENDPOINT: process.env.API_ENDPOINT,
  NODE_ENV: process.env.NODE_ENV,
});

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Example API methods
  openPath: (path: string) => ipcRenderer.invoke('dialog:openPath', path),
  
  // Get app version
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  
  // Platform information
  getPlatform: () => process.platform,
  
  // Example of sending messages to main process
  sendMessage: (message: string) => ipcRenderer.invoke('app:sendMessage', message),
  
  // Example of listening to messages from main process
  onMessage: (callback: (message: string) => void) => {
    ipcRenderer.on('app:message', (event: any, message: any) => callback(message));
  },
  
  // Remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

// Custom logging for development
console.log('Preload script loaded successfully');