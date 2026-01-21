// redirect 'debug' output to a file
import fs from "node:fs";
import os from "node:os";
import util from "node:util";
import createDebug from "debug";

const keepaiDir = path.join(os.homedir(), ".keep.ai");
const logPath = path.join(keepaiDir, "debug.log");
const logStream = fs.createWriteStream(logPath, { flags: "a" });

// Save original log target (usually console.error or console.log)
const originalLog = createDebug.log || console.log;

// Override for ALL debug instances (app + dependencies)
createDebug.log = (...args) => {
  const line = util.format(...args);

  // Optional: keep printing to console in dev
  originalLog(line);

  // Always write to file
  logStream.write(line + "\n");
};

// Now import the rest
import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  Tray,
  nativeImage,
  protocol,
  net,
  shell,
  Notification,
  globalShortcut,
} from "electron";
import path from "path";
import { createServer } from "@app/server";
import contextMenu from "electron-context-menu";
import { fileURLToPath } from "node:url";
import debug from "debug";

const debugMain = debug("main");

const disposeContextMenu = contextMenu({
  showSaveImageAs: true,
  showCopyLink: true,
});

/**
 * Get the app icon as a NativeImage.
 * Returns icon from file if exists, otherwise generates from embedded SVG.
 * The SVG matches the "K in square" design from SharedHeader.
 */
function getAppIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, "../assets/icon.png");

  // Try to load from file first
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  } catch (error) {
    debugMain('Could not load icon from file:', error);
  }

  // Fallback: create from embedded SVG (matches the "K in square" design)
  // Golden border: #D6A642, white background, black K
  try {
    const svgIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
        <rect x="8" y="8" width="240" height="240" rx="24" ry="24" fill="white" stroke="#D6A642" stroke-width="16"/>
        <text x="128" y="168" font-family="Arial, sans-serif" font-size="160" font-weight="bold" text-anchor="middle" fill="black">K</text>
      </svg>
    `;
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgIcon).toString('base64')}`;
    return nativeImage.createFromDataURL(dataUrl);
  } catch (error) {
    debugMain('Could not create icon from SVG:', error);
    // Return empty image as last resort - app continues to function
    return nativeImage.createEmpty();
  }
}

// Keep a global reference of the window object
let mainWindow: any = null;
let server: any = null;
let serverPort: number = 0;
let tray: Tray | null = null;
let isQuiting = false;

// Track if window webContents has finished loading
let windowReady = false;
let windowReadyPromise: Promise<void> | null = null;
let windowReadyResolve: (() => void) | null = null;
let windowReadyReject: ((reason: Error) => void) | null = null;

/**
 * Wait for the window to be ready to receive IPC messages.
 * Returns immediately if window is already ready.
 * Creates the window if it doesn't exist.
 */
async function ensureWindowReady(): Promise<void> {
  if (!mainWindow) {
    createWindow();
  }

  if (windowReady) {
    return;
  }

  if (windowReadyPromise) {
    return windowReadyPromise;
  }

  // Window exists but not yet ready - wait for it
  windowReadyPromise = new Promise((resolve, reject) => {
    windowReadyResolve = resolve;
    windowReadyReject = reject;
  });

  return windowReadyPromise;
}

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false, // Security best practice
      contextIsolation: true, // Security best practice
      preload: path.join(__dirname, "preload.cjs"), // Use a preload script
    },
    icon: getAppIcon(),
    title: "Keep.AI",
  });

  // Load the SPA build
  mainWindow.loadFile(path.join(__dirname, "../public/index.html"));

  // Track when webContents finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    debugMain('Window webContents finished loading');
    windowReady = true;
    if (windowReadyResolve) {
      windowReadyResolve();
      windowReadyResolve = null;
      windowReadyPromise = null;
    }
  });

  // Open DevTools in development
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  // Instead of closing, just hide to tray
  mainWindow.on("close", (event: any) => {
    if (!isQuiting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Handle window closed
  mainWindow.on("closed", () => {
    // Reject any pending promise before clearing references
    // This prevents callers from hanging indefinitely
    if (windowReadyReject) {
      windowReadyReject(new Error('Window was closed'));
    }
    mainWindow = null;
    windowReady = false;
    windowReadyPromise = null;
    windowReadyResolve = null;
    windowReadyReject = null;
  });

  // Optional: minimize to tray instead
  mainWindow.on("minimize", (event: any) => {
    event.preventDefault();
    mainWindow?.hide();
  });
}

// IPC Handlers
function setupIpcHandlers(): void {
  // Handle app version request
  ipcMain.handle("app:getVersion", () => {
    try {
      return app.getVersion();
    } catch (error) {
      debugMain('Failed to get app version:', error);
      return 'unknown';
    }
  });

  // Handle external URL opening
  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return true;
    } catch (error) {
      debugMain('Failed to open external URL:', error);
      return false;
    }
  });

  // Handle OS-level notifications for workflow errors [Spec 09]
  ipcMain.handle('show-notification', async (_event, options: {
    title: string;
    body: string;
    workflowId?: string;
  }) => {
    if (!Notification.isSupported()) {
      debugMain('Notifications are not supported on this system');
      return false;
    }

    try {
      const notification = new Notification({
        title: options.title,
        body: options.body,
        icon: getAppIcon(),
      });

      // When user clicks the notification, open the app
      notification.on('click', async () => {
        try {
          await ensureWindowReady();
          mainWindow?.show();
          mainWindow?.focus();

          // If workflowId provided, navigate to workflow detail page
          if (options.workflowId) {
            mainWindow?.webContents.send('navigate-to', `/workflows/${options.workflowId}`);
          }
        } catch (error) {
          debugMain('Failed to handle notification click:', error);
        }
      });

      notification.show();
      return true;
    } catch (error) {
      debugMain('Failed to create notification:', error);
      return false;
    }
  });

  // Handle tray badge update for attention items [Spec 00, 09]
  ipcMain.handle('update-tray-badge', async (_event, count: number) => {
    try {
      if (!tray) return false;

      // On macOS, show badge count in tray title
      if (process.platform === 'darwin') {
        if (count > 0) {
          tray.setTitle(` ${count}`);
        } else {
          tray.setTitle('');
        }
      }

      // Update tooltip to reflect attention items
      if (count > 0) {
        tray.setToolTip(`Keep.AI - ${count} automation${count > 1 ? 's' : ''} need attention`);
      } else {
        tray.setToolTip('Keep.AI - Your Private AI Assistant');
      }
      return true;
    } catch (error) {
      debugMain('Failed to update tray badge:', error);
      return false;
    }
  });

  // // Handle message sending
  // ipcMain.handle("app:sendMessage", (event: any, message: string) => {
  //   console.log("Received message from renderer:", message);

  //   // Echo the message back with a timestamp
  //   const response = `Echo: ${message} (received at ${new Date().toLocaleTimeString()})`;

  //   // You could also send a message back to the renderer
  //   if (mainWindow) {
  //     mainWindow.webContents.send(
  //       "app:message",
  //       `Main process received: ${message}`
  //     );
  //   }

  //   return response;
  // });

  // // Handle dialog operations
  // ipcMain.handle("dialog:openPath", async (event: any, path: string) => {
  //   console.log("Opening path:", path);
  //   return `Path opened: ${path}`;
  // });
}

function createTray(): void {
  const trayIcon = getAppIcon();
  tray = new Tray(trayIcon);
  tray.setToolTip("Keep.AI - Your Private AI Assistant");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Keep.AI",
      click: async () => {
        try {
          await ensureWindowReady();
          mainWindow?.show();
          mainWindow?.focus();
        } catch (error) {
          debugMain('Failed to open window from tray:', error);
        }
      },
    },
    { type: "separator" },
    {
      label: "New automation...",
      accelerator: "CmdOrCtrl+N",
      click: async () => {
        try {
          await ensureWindowReady();
          mainWindow?.show();
          mainWindow?.focus();
          // Send message to renderer to focus the input
          mainWindow?.webContents.send('focus-input');
        } catch (error) {
          debugMain('Failed to open new automation from tray:', error);
        }
      },
    },
    {
      label: "Pause all automations",
      click: async () => {
        try {
          await ensureWindowReady();
          // Send message to renderer to pause all workflows
          if (mainWindow) {
            mainWindow.webContents.send('pause-all-automations');
          }
          debugMain('Pause all automations requested');
        } catch (error) {
          debugMain('Failed to pause all automations:', error);
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Single-click on tray restores window
  tray.on("click", async () => {
    try {
      await ensureWindowReady();
      if (mainWindow?.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow?.show();
        mainWindow?.focus();
      }
    } catch (error) {
      debugMain('Failed to handle tray click:', error);
    }
  });
}

// Small helper for local files
function guessMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
    case ".htm":
      return "text/html";
    case ".js":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

async function fetchFile(fileIdOrName: string) {
  const url = `${process.env.API_ENDPOINT}/file/get?url=${encodeURIComponent(
    fileIdOrName
  )}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Fetch error: ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType =
    res.headers.get("content-type") || "application/octet-stream";

  return { buffer, mimeType };
}

/**
 * Register global keyboard shortcuts [Spec 00, 01]
 */
function registerGlobalShortcuts(): void {
  // Cmd/Ctrl+N: Open app and focus input for new automation
  const registered = globalShortcut.register('CmdOrCtrl+N', async () => {
    debugMain('Global shortcut CmdOrCtrl+N triggered');
    try {
      await ensureWindowReady();
      mainWindow?.show();
      mainWindow?.focus();
      // Send message to renderer to focus the input
      mainWindow?.webContents.send('focus-input');
    } catch (error) {
      debugMain('Failed to handle global shortcut:', error);
    }
  });

  if (!registered) {
    debugMain('Failed to register global shortcut CmdOrCtrl+N');
  } else {
    debugMain('Global shortcut CmdOrCtrl+N registered');
  }
}

function setupDownloadHandler() {
  // Handle all file:// requests in this session
  protocol.handle("file", async (request) => {
    debugMain("fetch", request.url);
    try {
      const url = new URL(request.url);
      const { pathname } = url;

      // file:///files/get/<id>  or file:///C:/files/get/<id>
      if (pathname.includes("/files/get/")) {
        const fileIdOrName = pathname.split("/files/get/")[1];

        // Build request to server
        const apiUrl = `${
          process.env.API_ENDPOINT
        }/file/get?url=${encodeURIComponent(fileIdOrName)}`;

        // Use Electron's net.fetch so cookies/session etc are consistent
        // This returns a Response that protocol.handle can return directly.
        return net.fetch(apiUrl);
      }

      // Everything else: serve local file from disk
      // request.url is file:///absolute/path/to/file
      const filePath = fileURLToPath(request.url);

      const data = await fs.promises.readFile(filePath);
      const mimeType = guessMimeType(filePath);

      return new Response(data, {
        headers: { "content-type": mimeType },
      });
    } catch (err) {
      debugMain("[protocol.handle(file)] error:", err);
      return new Response("Internal error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  try {
    // Start the API server
    server = await createServer({
      serveStaticFiles: false, // We don't need static file serving in electron
    });

    const { port } = await server.listen({
      port: 0, // Use any available port
      host: "localhost",
    });

    serverPort = port;
    debugMain(`API server started on port ${port}`);

    // Set environment variable for SPA
    process.env.API_ENDPOINT = `http://localhost:${port}/api`;

    setupDownloadHandler();
    setupIpcHandlers();
    createWindow();
    createTray();
    registerGlobalShortcuts();

    // Hide dock icon on macOS to make it a pure tray app
    if (process.platform === "darwin" && app.dock) {
      app.dock.hide();
    }
  } catch (error) {
    debugMain("Failed to start server:", error);
    app.quit();
  }

  // Create application menu
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Quit",
          accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            mainWindow?.webContents.reload();
          },
        },
        {
          label: "Toggle DevTools",
          accelerator:
            process.platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I",
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// With tray functionality, we don't quit when all windows are closed
app.on("window-all-closed", () => {
  // Keep the app running in the tray - don't quit
  // The server will continue running in the background
  debugMain("All windows closed, app continues running in tray");
});

// Handle app quit - only when explicitly quitting (e.g., from tray menu)
app.on("before-quit", async (event: any) => {
  if (server && !isQuiting) {
    event.preventDefault();
    isQuiting = true;
    try {
      debugMain("Closing server before quit...");
      await server.close();
      server = null;
      debugMain("Server closed, quitting app...");
      disposeContextMenu();
      app.quit();
    } catch (error) {
      debugMain("Error closing server:", error);
      app.quit();
    }
  }
});

// Handle tray and global shortcuts cleanup on quit
app.on("will-quit", () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();

  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// Security: Prevent navigation to external URLs
app.on("web-contents-created", (event: any, contents: any) => {
  contents.on(
    "will-navigate",
    (navigationEvent: any, navigationUrl: string) => {
      const parsedUrl = new URL(navigationUrl);

      if (parsedUrl.origin !== "file://") {
        navigationEvent.preventDefault();
      }
    }
  );
});
