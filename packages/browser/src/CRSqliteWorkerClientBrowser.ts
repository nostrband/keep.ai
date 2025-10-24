// Reusable CRSqlite Tab Synchronization class
import { DBInterface } from "@app/db";
import {
  BroadcastMessage,
  WorkerMessage,
  CRSqliteWorkerClientBase,
} from "@app/sync";
import { LeaderWebWorker, stableName } from "./LeaderWebWorker";
import debug from "debug";

const debugCRSqliteWorkerClientBrowser = debug(
  "browser:CRSqliteWorkerClientBrowser"
);

function supportsNativeSharedWorkerModule(): boolean {
  try {
    const blob = new Blob(["export {};"], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    // @ts-ignore
    const w = new SharedWorker(url, { type: "module" });
    w.port.close();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export class CRSqliteWorkerClientBrowser extends CRSqliteWorkerClientBase {
  private worker: LeaderWebWorker | null = null;
  private port: MessagePort | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private sharedWorkerUrl?: string;
  private dedicatedWorkerUrl?: string;

  constructor({
    db,
    onTablesChanged,
    sharedWorkerUrl,
    dedicatedWorkerUrl,
  }: {
    db: DBInterface;
    onTablesChanged?: (tables: string[]) => void;
    sharedWorkerUrl?: string;
    dedicatedWorkerUrl?: string;
  }) {
    super(db, async (msg) => this.broadcastMessage(msg), onTablesChanged);
    this.sharedWorkerUrl = sharedWorkerUrl;
    this.dedicatedWorkerUrl = dedicatedWorkerUrl;
  }

  async start(): Promise<void> {
    super.start();

    if (this.isStarted) return;

    // reset to run the second part of the start routine
    this.isStarted = true;
    try {
      if (this.sharedWorkerUrl && supportsNativeSharedWorkerModule()) {
        // Initialize shared worker
        const worker = new SharedWorker(this.sharedWorkerUrl, {
          type: "module",
          name: stableName(String(this.sharedWorkerUrl)),
        });

        this.port = worker.port;

        // Set up worker message handling
        this.port.addEventListener("message", (e) =>
          this.processWorkerMessage(e.data)
        );
        this.port.start();
      } else if (this.dedicatedWorkerUrl) {
        // Initialize shared worker
        this.worker = new LeaderWebWorker(this.dedicatedWorkerUrl, {
          type: "module",
        });

        // Set up worker message handling
        this.worker.addEventListener("message", (e: MessageEvent) =>
          this.processWorkerMessage(e.data)
        );
        this.worker.addEventListener(
          "error",
          ({ reason, error }: { reason: string; error?: unknown }) => {
            debugCRSqliteWorkerClientBrowser("Failed to start:", reason, error);
            if (this.onError) {
              this.onError(reason);
            }
          }
        );

        // Starts the worker if tab is leader
        await this.worker.start();
      } else {
        throw new Error("Supported worker mode not available");
      }

      // Set up broadcast channel
      this.broadcastChannel = new BroadcastChannel("db-sync");
      this.broadcastChannel.addEventListener("message", (e) =>
        this.processChanges(e.data)
      );

      // Request initial sync immediately
      this.postMessage({ type: "sync" });

      this.isStarted = true;
      debugCRSqliteWorkerClientBrowser("Started successfully");
    } catch (error) {
      debugCRSqliteWorkerClientBrowser("Failed to start:", error);
      if (this.onError) {
        this.onError((error as Error).message);
      }
      throw error;
    }
  }

  stop(): void {
    if (!this.isStarted) return;

    debugCRSqliteWorkerClientBrowser("Stopping...");

    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    if (this.port) {
      this.port.close();
      this.port = null;
    }

    this.worker = null;

    debugCRSqliteWorkerClientBrowser("Stopped");
  }

  protected postMessage(message: WorkerMessage): void {
    if (this.port) this.port.postMessage(message);
    else this.worker!.postMessage(message);
  }

  private async broadcastMessage(message: BroadcastMessage): Promise<void> {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(message);
    }
  }
}
