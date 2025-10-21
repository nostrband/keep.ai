/// <reference lib="webworker" />
// Reusable CRSqlite Shared Worker class
import { DBInterface } from "@app/db";
import { CRSqliteWorkerBase, BroadcastMessage, WorkerResponse } from "@app/worker";
import debug from "debug";

const debugCRSqliteDedicatedWorker = debug("browser:CRSqliteDedicatedWorker");

export class CRSqliteDedicatedWorker extends CRSqliteWorkerBase {
  private pending: MessageEvent[] = [];
  private broadcastChannel: BroadcastChannel | null = null;

  constructor(db: DBInterface | (() => DBInterface)) {
    super(db, (msg) => this.broadcastChanges(msg));

    // Immediately
    globalThis.addEventListener("message", (m) => {
      if (!this.isStarted) this.pending.push(m);
      else this.processClientMessage(m.data, globalThis);
    });
  }

  async start(): Promise<void> {
    await super.start();
    try {
      // Initialize broadcast channel for tab communication
      this.broadcastChannel = new BroadcastChannel("db-sync");
      this.broadcastChannel.addEventListener("message", (event) => {
        this.processChanges(event.data);
      });

      globalThis.postMessage({
        type: "ready",
        siteId: this.siteId,
      } as WorkerResponse);

      for (const m of this.pending)
        this.processClientMessage(m.data, globalThis);
      this.pending.length = 0;
    } catch (error) {
      debugCRSqliteDedicatedWorker("Failed to start:", error);
      this.isStarted = false;
      throw error;
    }
  }

  stop(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    super.stop();
  }

  private async broadcastChanges(message: BroadcastMessage) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(message);
    }
  }
}