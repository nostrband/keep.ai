/// <reference lib="webworker" />
import debug from "debug";
import { API_ENDPOINT } from "./const";
import { SyncWorker } from "./lib/worker";

declare const self: SharedWorkerGlobalScope;

const log = debug("keep:shared-worker");

const initializeWorker = async () => {
  const worker = new SyncWorker(API_ENDPOINT + "/worker");

  // Set up connection handler immediately (no awaits above it)
  self.addEventListener("connect", (event: MessageEvent) => {
    log("got connect, ports:", event.ports.length);
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

log("Starting...");

// Initialize the worker when it starts
initializeWorker();
