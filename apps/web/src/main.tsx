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

// NOTE: if switching providers, also switch in useDbQuery
import { QueryProviderEmbedded } from "./QueryProviderEmbedded.tsx";
import { QueryProvider } from "./QueryProvider.tsx";
// import sharedWorkerUrl from "./shared-worker.ts?sharedworker&url";
import dedicatedWorkerUrl from "./worker.ts?sharedworker&url";

declare const __ELECTRON__: boolean;
const isElectron = __ELECTRON__; // (import.meta as any).env?.VITE_FLAVOR === "electron";

// FIXME debug
debug.enable("*");

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

// Register service worker for PWA and push notifications
if (!isElectron && "serviceWorker" in navigator) {
  console.log("Registering service worker");
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "/service-worker.js",
        {
          type: "module",
        }
      );
      console.log("Service Worker registered successfully:", registration);

      // Update service worker if needed
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              console.log("New service worker installed, consider refresh");
            }
          });
        }
      });
    } catch (error) {
      console.error("Service Worker registration failed:", error);
    }
  });
}
