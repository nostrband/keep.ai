// Refactored Shared Worker using CRSqliteSharedWorker class

import { createDBBrowser, CRSqliteSharedWorker } from "@app/browser";
import { DBInterface, KeepDb } from "@app/db";
import { DB_FILE } from "./const";
import { CRSqliteWorkerClientHTTP } from "@app/sync";

const initializeWorker = async () => {
  try {
    console.log("[SharedWorker] Initializing...");

    // Create and initialize TestDB
    let db: DBInterface | undefined;

    // Create CRSqliteSharedWorker with the DB instance
    const worker = new CRSqliteSharedWorker(() => {
      if (!db) throw new Error("DB not created yet");
      return db;
    });

    // Set up connection handler immediately (no awaits above it)
    self.addEventListener("connect", (event: any) => {
      console.log("[SharedWorker] got connect, ports:", event?.ports?.length);
      worker.onConnect(event.ports[0]);
    });

    db = await createDBBrowser(DB_FILE);
    const keepDB = new KeepDb(db);

    // Initialize database
    await keepDB.start();


    const backendClient = new CRSqliteWorkerClientHTTP(db, "/api/worker", undefined, () => {
      worker.checkChanges();
    })
    await backendClient.start();

    // Start the worker, now it will process the pending connects
    await worker.start();

    console.log("[SharedWorker] Initialized successfully");
  } catch (error) {
    console.error("[SharedWorker] Failed to initialize:", error);
  }
};

// Initialize the worker when it starts
initializeWorker();

console.log("[SharedWorker] Shared worker started");
