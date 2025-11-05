/// <reference lib="webworker" />
import { SyncWorker } from "./ui/lib/worker";

declare const self: SharedWorkerGlobalScope;

const initializeWorker = async () => {
  const worker = new SyncWorker();

  // Set up connection handler immediately (no awaits above it)
  self.addEventListener("connect", (event: MessageEvent) => {
    console.log("[SharedWorker] got connect, ports:", event.ports.length);
    if (event.ports.length) {
      const port = event.ports[0];
      worker.addPort(port);

      // can start now after it's added to transport
      port.start();
    }
  });

  // Can start after on-connect handler added
  worker.start();
};

console.log("[SharedWorker] Starting...");

// Initialize the worker when it starts
initializeWorker();
