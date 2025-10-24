/// <reference lib="webworker" />

import { WorkerTransport } from "@app/browser";
import { KeepDb } from "@app/db";
import { API_ENDPOINT, DB_FILE } from "./const";
import { Peer, TransportClientHttp } from "@app/sync";
import { createDB } from "./db";

declare const self: SharedWorkerGlobalScope;

const initializeWorker = async () => {
  try {
    console.log("[SharedWorker] Initializing...");

    // First thing in sync section - create WorkerTransport
    // and make sure onmessage handler is attached

    // Talk to the tab that created the worker
    const tabTransport = new WorkerTransport();

    // Talk to backend server over http
    const backendTransport = new TransportClientHttp(API_ENDPOINT);
    // Set up connection handler immediately (no awaits above it)
    self.addEventListener("connect", (event: MessageEvent) => {
      console.log("[SharedWorker] got connect, ports:", event.ports.length);
      if (event.ports.length) {
        const port = event.ports[0];
        tabTransport.addMessagePort(port);
        // can start now after it's added to transport
        port.start();
      }
    });

    // Create local persistent db
    const db = await createDB(DB_FILE);
    const keepDB = new KeepDb(db);

    // Initialize database
    await keepDB.start();

    // Create cr-sqlite peer with 2 transports
    const peer = new Peer(db, [tabTransport, backendTransport]);

    // Start peer
    await peer.start();

    // Start transports after peer has configuration for them
    await tabTransport.start(peer.getConfig());
    await backendTransport.start(peer.getConfig());

    console.log("[SharedWorker] Initialized successfully");
  } catch (error) {
    console.error("[SharedWorker] Failed to initialize:", error);
  }
};

// Initialize the worker when it starts
initializeWorker();

console.log("[SharedWorker] Shared worker started");
