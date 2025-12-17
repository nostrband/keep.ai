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

// Keep a global reference of the window object
let mainWindow: any = null;
let server: any = null;
let serverPort: number = 0;
let tray: Tray | null = null;
let isQuiting = false;

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
    icon: path.join(__dirname, "../assets/icon.png"), // Optional: Add an app icon
    title: "Keep.AI",
  });

  // Load the SPA build
  mainWindow.loadFile(path.join(__dirname, "../public/index.html"));

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
    mainWindow = null;
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
    return app.getVersion();
  });

  // Handle external URL opening
  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url);
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
  // Try to find an icon, fallback to a basic one if not found
  const iconPath = path.join(__dirname, "../assets/icon.png");
  let trayIcon;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    // If icon is empty, create a simple fallback
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createFromNamedImage("NSApplicationIcon");
    }
  } catch (error) {
    // Fallback to system icon if app icon not found
    trayIcon = nativeImage.createFromNamedImage("NSApplicationIcon");
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("Keep.AI - Your Private AI Assistant");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Keep.AI",
      click: () => {
        if (!mainWindow) {
          createWindow();
        }
        mainWindow?.show();
        mainWindow?.focus();
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
  tray.on("click", () => {
    if (!mainWindow) {
      createWindow();
    }
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
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

// Handle tray cleanup on quit
app.on("will-quit", () => {
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
