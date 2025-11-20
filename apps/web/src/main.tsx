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
import { QueryProviderEmbedded } from "./QueryProviderEmbedded.tsx";
import { API_ENDPOINT } from "./const.ts";
// import sharedWorkerUrl from "./shared-worker.ts?sharedworker&url";
// import dedicatedWorkerUrl from "./worker.ts?sharedworker&url";

// FIXME debug
debug.enable("*");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryProviderEmbedded
      backendUrl={API_ENDPOINT}
      // sharedWorkerUrl={sharedWorkerUrl}
      // dedicatedWorkerUrl={dedicatedWorkerUrl}
      queryClient={queryClient}
      setOnLocalChanges={setOnLocalChanges}
      onRemoteChanges={(tables, api) => notifyTablesChanged(tables, false, api)}
    >
      <App />
    </QueryProviderEmbedded>
  </React.StrictMode>
);
