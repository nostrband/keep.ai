import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// @ts-ignore
import sharedWorkerUrl from "./shared-worker.ts?sharedworker&url";
// @ts-ignore
import dedicatedWorkerUrl from "./worker.ts?worker&url";
import { QueryProvider } from "./QueryProvider.tsx";
import { notifyTablesChanged, queryClient, setOnLocalChanges } from "./queryClient.ts";

import debug from "debug";
import { API_ENDPOINT } from "./const.ts";

debug.enable("*");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryProvider
      // Using it for testing to bypass workers
      // backendUrl={API_ENDPOINT}
      sharedWorkerUrl={sharedWorkerUrl}
      dedicatedWorkerUrl={dedicatedWorkerUrl}
      queryClient={queryClient}
      setOnLocalChanges={setOnLocalChanges}
      onRemoteChanges={(tables) => notifyTablesChanged(tables, false)}
    >
      <App />
    </QueryProvider>
  </React.StrictMode>
);
