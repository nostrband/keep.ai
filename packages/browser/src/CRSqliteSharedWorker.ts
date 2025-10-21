// Reusable CRSqlite Shared Worker class
import { DBInterface } from "@app/db";
import { CRSqliteWorkerBase, BroadcastMessage, WorkerResponse } from "@app/worker";
import debug from "debug";

const debugCRSqliteSharedWorker = debug("browser:CRSqliteSharedWorker");

export class CRSqliteSharedWorker extends CRSqliteWorkerBase {
  private pendingPorts: MessagePort[] = [];
  private broadcastChannel: BroadcastChannel | null = null;

  constructor(db: DBInterface | (() => DBInterface)) {
    super(db, (msg) => this.broadcastChanges(msg));
  }

  async start(): Promise<void> {
    await super.start();

    try {
      // Initialize broadcast channel for tab communication
      this.broadcastChannel = new BroadcastChannel("db-sync");
      this.broadcastChannel.addEventListener("message", (event) => {
        this.processChanges(event.data);
      });

      this.processPendingPorts();
    } catch (error) {
      debugCRSqliteSharedWorker("Failed to start:", error);
      this.isStarted = false;
      throw error;
    }
  }

  onConnect(port: MessagePort): void {
    debugCRSqliteSharedWorker("New tab connected, isStarted:", this.isStarted);

    if (this.isStarted) {
      // Worker is ready, set up handlers immediately
      this.setupPortHandlers(port);
    } else {
      // Worker not ready yet, queue the connection
      debugCRSqliteSharedWorker("Worker not started, queueing connection");
      this.pendingPorts.push(port);
    }
  }

  private processPendingPorts(): void {
    debugCRSqliteSharedWorker(`Processing ${this.pendingPorts.length} pending connections`);

    while (this.pendingPorts.length > 0) {
      const port = this.pendingPorts.shift()!;
      this.setupPortHandlers(port);
    }
  }

  private setupPortHandlers(port: MessagePort): void {
    debugCRSqliteSharedWorker("Setting up port handlers for connected tab");

    port.addEventListener("message", (m) => this.processClientMessage(m.data, port));

    port.start();

    port.postMessage({
      type: "ready",
      siteId: this.siteId,
    } as WorkerResponse);
  }

  private async broadcastChanges(message: BroadcastMessage) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(message);
    }
  }

  stop(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    super.stop();
    this.pendingPorts.length = 0;
  }
}