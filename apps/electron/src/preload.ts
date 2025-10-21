import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  sendToWorker: (data: any) => ipcRenderer.invoke('worker-request', data),
  onWorkerMessage: (callback: (data: any) => void) => 
    ipcRenderer.on('worker-message', (_event, data) => callback(data)),
  removeWorkerListener: () => ipcRenderer.removeAllListeners('worker-message')
});