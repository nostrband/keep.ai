import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import path from 'path';
// import { fileURLToPath } from 'url';
import { createServer } from '@app/server';

// ES module equivalent of __dirname
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// Keep a global reference of the window object
let mainWindow: any = null;
let server: any = null;
let serverPort: number = 0;

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false, // Security best practice
      contextIsolation: true, // Security best practice
      preload: path.join(__dirname, 'preload.cjs'), // Use a preload script
    },
    icon: path.join(__dirname, '../assets/icon.png'), // Optional: Add an app icon
    title: 'Keep.AI',
  });

  // Load the SPA build
  mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
function setupIpcHandlers(): void {
  // Handle app version request
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  // Handle message sending
  ipcMain.handle('app:sendMessage', (event: any, message: string) => {
    console.log('Received message from renderer:', message);
    
    // Echo the message back with a timestamp
    const response = `Echo: ${message} (received at ${new Date().toLocaleTimeString()})`;
    
    // You could also send a message back to the renderer
    if (mainWindow) {
      mainWindow.webContents.send('app:message', `Main process received: ${message}`);
    }
    
    return response;
  });

  // Handle dialog operations
  ipcMain.handle('dialog:openPath', async (event: any, path: string) => {
    console.log('Opening path:', path);
    return `Path opened: ${path}`;
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  try {
    // Start the API server
    server = await createServer({
      serveStaticFiles: false // We don't need static file serving in electron
    });
    
    const { port } = await server.listen({
      port: 0, // Use any available port
      host: 'localhost'
    });
    
    serverPort = port;
    console.log(`API server started on port ${port}`);
    
    // Set environment variable for SPA
    process.env.API_ENDPOINT = `http://localhost:${port}/api`;
    
    setupIpcHandlers();
    createWindow();
  } catch (error) {
    console.error('Failed to start server:', error);
    app.quit();
  }

  // Create application menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow?.webContents.reload();
          },
        },
        {
          label: 'Toggle DevTools',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => {
            mainWindow?.webContents.toggleDevTools();
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // macOS specific behavior
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', async () => {
  // Close the server when quitting
  if (server) {
    try {
      await server.close();
      server = undefined;
    } catch (error) {
      console.error('Error closing server:', error);
    }
  }
  
  // On macOS, keep the app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app quit
app.on('before-quit', async (event: any) => {
  if (server) {
    event.preventDefault();
    try {
      await server.close();
      server = null;
      app.quit();
    } catch (error) {
      console.error('Error closing server:', error);
      app.quit();
    }
  }
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (event: any, contents: any) => {
  contents.on('will-navigate', (navigationEvent: any, navigationUrl: string) => {
    const parsedUrl = new URL(navigationUrl);
    
    if (parsedUrl.origin !== 'file://') {
      navigationEvent.preventDefault();
    }
  });
});