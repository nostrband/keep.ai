import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// import { QueryProvider } from "./QueryProvider.tsx";
import {
  notifyTablesChanged,
  queryClient,
  setOnLocalChanges,
} from "./queryClient.ts";
import debug from "debug";
import { API_ENDPOINT } from "./const.ts";
import { safeLocalStorageGet } from "./lib/safe-storage.ts";

// NOTE: if switching providers, also switch in useDbQuery
import { QueryProviderEmbedded } from "./QueryProviderEmbedded.tsx";
import { QueryProvider } from "./QueryProvider.tsx";
// import sharedWorkerUrl from "./shared-worker.ts?sharedworker&url";
import dedicatedWorkerUrl from "./worker.ts?sharedworker&url";

declare const __ELECTRON__: boolean;
const isElectron = __ELECTRON__; // (import.meta as any).env?.VITE_FLAVOR === "electron";

// Enable debug output in development mode or when debug mode is enabled via settings
// Use safe localStorage access for incognito/private mode compatibility
const debugModeEnabled = safeLocalStorageGet("keep-ai-debug-mode") === "true";
if (import.meta.env.DEV || debugModeEnabled) {
  debug.enable("*");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryProviderEmbedded
      backendUrl={API_ENDPOINT + "/worker"}
      // sharedWorkerUrl={sharedWorkerUrl}
      // dedicatedWorkerUrl={dedicatedWorkerUrl}
      queryClient={queryClient}
      setOnLocalChanges={setOnLocalChanges}
      onRemoteChanges={(tables, api) => notifyTablesChanged(tables, false, api)}
    >
      <App />
    </QueryProviderEmbedded>

    {/* <QueryProvider
      // backendUrl={API_ENDPOINT}
      // sharedWorkerUrl={sharedWorkerUrl}
      dedicatedWorkerUrl={dedicatedWorkerUrl}
      queryClient={queryClient}
      setOnLocalChanges={setOnLocalChanges}
      onRemoteChanges={(tables, api) => notifyTablesChanged(tables, false, api)}
    >
      <App />
    </QueryProvider> */}
  </React.StrictMode>
);

// Custom event for app update notification
export const APP_UPDATE_EVENT = 'keep-ai-app-updated';

// Register service worker for PWA and push notifications
if (!isElectron && "serviceWorker" in navigator) {
  // Track whether we've had a controller before (to distinguish first install from updates)
  let hadController = !!navigator.serviceWorker.controller;

  // Listen for controller changes - this fires exactly when a new SW takes control
  // This is more reliable than listening to 'activated' state which may fire
  // before the controller actually changes
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only notify if there was a previous controller (not first install)
    if (hadController) {
      window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT));
    }
    // Update the flag for future controller changes
    hadController = true;
  });

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register(
        "/service-worker.js",
        {
          type: "module",
        }
      );
    } catch (error) {
      console.error("Service Worker registration failed:", error);
    }
  });
}
