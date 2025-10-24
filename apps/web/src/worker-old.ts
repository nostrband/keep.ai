/// <reference lib="webworker" />
import { createDBBrowser, CRSqliteDedicatedWorker } from "@app/browser";
import { DBInterface, KeepDb } from "@app/db";
import { DB_FILE } from "./const";
import { CRSqliteWorkerClientHTTP } from "@app/sync";

async function main() {
  console.log("[Worker] Initializing...");
  let db: DBInterface | undefined;
  let backendClient: CRSqliteWorkerClientHTTP | undefined;

  // Create ASAP to make sure 'message' handler is attached early
  const worker = new CRSqliteDedicatedWorker(
    () => {
      if (!db) throw new Error("DB not created yet");
      return db;
    },
    () => backendClient!.checkChanges()
  );

  db = await createDBBrowser(DB_FILE);
  const keepDB = new KeepDb(db);

  // We're syncing to backend over http
  backendClient = new CRSqliteWorkerClientHTTP(
    db,
    "/api/worker",
    undefined,
    () => worker.checkChanges()
  );

  // Initialize database
  await keepDB.start();

  // Now can sync
  await backendClient.start();

  // Process requests
  await worker.start();

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
