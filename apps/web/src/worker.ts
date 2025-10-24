/// <reference lib="webworker" />

import { MessagePortLike, WorkerTransport } from "@app/browser";
import { KeepDb } from "@app/db";
import { Peer, TransportClientHttp } from "@app/sync";
import { API_ENDPOINT, DB_FILE } from "./const";
import debug from "debug";
import { createDB } from "./db";

debug.enable("*");

// MessagePortLike implementation that forwards to globalThis
class GlobalMessagePort implements MessagePortLike {
  postMessage(message: any): void {
    globalThis.postMessage(message);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent) => void
  ): void {
    globalThis.addEventListener(type, listener as EventListener);
  }
}

async function main() {
  console.log("[Worker] Initializing...");

  // First thing in sync section - create WorkerTransport
  // and make sure onmessage handler is attached

  // Talk to the tab that created the worker
  const tabTransport = new WorkerTransport();

  // Talk to backend server over http
  const backendTransport = new TransportClientHttp(API_ENDPOINT);

  // Create global message port
  const messagePort = new GlobalMessagePort();

  // Add port to tab transport in sync section to start listening ASAP
  tabTransport.addMessagePort(messagePort);

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

  console.log("[Worker] Initialized successfully");
}

main()
  .then(() => {
    console.log("[Worker] Started");
  })
  .catch((e) => {
    // make sure errors surface to devtools
    console.error("[Worker] Failed to initialize:", e);
  });
