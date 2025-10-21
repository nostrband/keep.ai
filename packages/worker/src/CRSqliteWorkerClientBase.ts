// Reusable CRSqlite Tab Synchronization class
import { DBInterface } from "@app/db";
import {
  BroadcastMessage,
  Change,
  WorkerMessage,
  WorkerResponse,
} from "./messages";
import { CRSqlitePeer } from "./CRSqlitePeer";
import debug from "debug";

const debugWorkerClientBase = debug("worker:CRSqliteWorkerClientBase");

export class CRSqliteWorkerClientBase extends CRSqlitePeer {
  protected tabId: string;
  private workerSiteId: Uint8Array | null = null;
  private pendingExecRequests = new Map<
    string,
    { resolve: (result: any) => void; reject: (error: Error) => void }
  >();
  private execRequestCounter = 0;

  // Event handlers
  private onSyncDataReceived: ((data: Change[]) => void) | null = null;
  protected onError: ((error: string) => void) | null = null;
  private onTablesChanged: ((tables: string[]) => void) | null = null;

  constructor(
    db: DBInterface,
    onChanges: (msg: BroadcastMessage) => Promise<void>,
    onTablesChanged?: (tables: string[]) => void
  ) {
    super(db, onChanges);

    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.onTablesChanged = onTablesChanged || null;
  }

  async start(): Promise<void> {
    if (this.isStarted) return;

    try {
      debugWorkerClientBase("Starting...");

      // Call parent start method which handles database initialization
      await super.start();

      debugWorkerClientBase("Started successfully");
    } catch (error) {
      debugWorkerClientBase("Failed to start:", error);
      if (this.onError) {
        this.onError((error as Error).message);
      }
      throw error;
    }
  }

  stop(): void {
    if (!this.isStarted) return;

    debugWorkerClientBase("Stopping...");

    // Call parent stop method
    super.stop();

    this.workerSiteId = null;

    debugWorkerClientBase("Stopped");
  }

  protected postMessage(message: WorkerMessage) {
    throw new Error("postMessage not implemented in worker client base");
  }

  public async processWorkerMessage(response: WorkerResponse) {
    debugWorkerClientBase(
      "Received worker message:",
      response
    );

    switch (response.type) {
      case "sync-data":
        if (response.changes) {
          try {
            await this.processChanges({
              type: "changes",
              data: response.changes,
            });

            if (this.onSyncDataReceived) {
              this.onSyncDataReceived(response.changes!);
            }
          } catch (error: any) {
            debugWorkerClientBase(
              "Error applying sync data:",
              error
            );
            if (this.onError) {
              this.onError(error.message);
            }
          }
        }
        break;

      case "exec-reply":
        // Handle exec reply by resolving the corresponding promise
        const requestId = response.requestId;
        if (requestId && this.pendingExecRequests.has(requestId)) {
          const { resolve } = this.pendingExecRequests.get(requestId)!;
          this.pendingExecRequests.delete(requestId);
          resolve(response.result);
        }
        break;

      case "ready":
        // Store worker site_id when worker is ready
        if (response.siteId) {
          this.workerSiteId = response.siteId;
          debugWorkerClientBase(
            "Received worker site_id:",
            this.workerSiteId
          );
        }
        break;

      case "error":
        debugWorkerClientBase(
          "Worker error:",
          response.error
        );

        // Check if this error is for a pending exec request
        const errorRequestId = response.requestId;
        if (errorRequestId && this.pendingExecRequests.has(errorRequestId)) {
          const { reject } = this.pendingExecRequests.get(errorRequestId)!;
          this.pendingExecRequests.delete(errorRequestId);
          reject(new Error(response.error || "Unknown worker error"));
        } else if (this.onError) {
          this.onError(response.error || "Unknown worker error");
        }
        break;
    }
  }

  public async processChanges(message: BroadcastMessage) {
    debugWorkerClientBase(
      "Received broadcast message:",
      message
    );

    try {
      const changes = await super.processChanges(message);
      const touched = new Set(changes.map(c => c.table));
      if (touched.size)
        this.onTablesChanged?.([...touched]);
      return changes;
    } catch (error: any) {
      debugWorkerClientBase(
        "Error applying broadcast changes:",
        error
      );
      if (this.onError) {
        this.onError(error.message || error.toString());
      }
      return [];
    }
  }

  async requestSync(): Promise<void> {
    if (!this.isStarted) {
      debugWorkerClientBase("Cannot sync - not started");
      return;
    }

    debugWorkerClientBase("Requesting manual sync");
    this.postMessage({ type: "sync" });
  }

  // Event handler setters
  onSyncData(handler: (data: Change[]) => void): void {
    this.onSyncDataReceived = handler;
  }

  onErrorOccurred(handler: (error: string) => void): void {
    this.onError = handler;
  }

  getTabId(): string {
    return this.tabId;
  }

  getLastBroadcastVersion(): number {
    return this.lastDbVersion;
  }

  isRunning(): boolean {
    return this.isStarted;
  }

  getWorkerSiteId(): Uint8Array | null {
    return this.workerSiteId;
  }

  // Remote database execution method
  async dbExec(sql: string, args: any[] = []): Promise<any> {
    if (!this.isStarted) {
      throw new Error("CRSqliteWorkerClientBase not started");
    }

    return new Promise((resolve, reject) => {
      const requestId = `exec-${this.execRequestCounter++}`;

      // Store the promise handlers
      let timeout: ReturnType<typeof setTimeout> | null = null;

      this.pendingExecRequests.set(requestId, {
        resolve: (v) => {
          if (timeout) clearTimeout(timeout);
          resolve(v);
        },
        reject,
      });

      // Send exec message to worker with request ID
      this.postMessage({
        type: "exec",
        sql,
        args,
        requestId,
      });

      // Set a timeout to avoid hanging forever
      timeout = setTimeout(() => {
        if (this.pendingExecRequests.has(requestId)) {
          this.pendingExecRequests.delete(requestId);
          reject(new Error("Database execution timeout"));
        }
      }, 10000); // 10 second timeout
    });
  }
}
