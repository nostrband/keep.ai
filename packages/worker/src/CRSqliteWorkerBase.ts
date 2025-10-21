// Reusable CRSqlite Shared Worker class
import { DBInterface } from "@app/db";
import { BroadcastMessage, Change, WorkerMessage, WorkerResponse } from "./messages";
import { CRSqlitePeer } from "./CRSqlitePeer";
import debug from "debug";

const debugWorkerBase = debug("worker:CRSqliteWorkerBase");

export interface WorkerResponsePort {
  postMessage: (response: WorkerResponse) => void;
}

export class CRSqliteWorkerBase extends CRSqlitePeer {
  constructor(db: DBInterface | (() => DBInterface), onChanges: (msg: BroadcastMessage) => Promise<void>) {
    super(db, onChanges);
  }

  async processClientMessage(message: WorkerMessage, port: WorkerResponsePort) {
    debugWorkerBase("Received message from tab:", message);

    try {
      switch (message.type) {
        case "sync":
          if (!this.isStarted) {
            port.postMessage({
              type: "error",
              error: "Worker not started",
            });
            return;
          }

          // Send all current changes to the requesting tab
          const changes = await this.getAllChanges();

          port.postMessage({
            type: "sync-data",
            changes: changes,
          });
          break;

        case "exec":
          if (!this.isStarted) {
            port.postMessage({
              type: "error",
              error: "Worker not started",
            });
            return;
          }

          try {
            // Execute the SQL query on the worker's database
            const result = await this.db.exec(message.sql!, message.args || []);

            // Check for changes and broadcast them
            await this.checkChanges();

            // Send reply with result, hopefully the changes have already been delivered
            port.postMessage({
              type: "exec-reply",
              result: result,
              requestId: message.requestId,
            });
          } catch (execError) {
            console.error(
              "Error executing SQL:",
              execError
            );
            port.postMessage({
              type: "error",
              error: (execError as Error).message,
              requestId: message.requestId,
            });
          }
          break;

        default:
          console.warn(
            "Unknown message type:",
            message.type
          );
      }
    } catch (error) {
      console.error("Error handling message:", error);
      port.postMessage({
        type: "error",
        error: (error as Error).message,
      });
    }
  }

  private async getAllChanges(): Promise<Change[]> {
    try {
      const result = await this.db.execO<Change>("SELECT * FROM crsql_changes");
      return result || [];
    } catch (error) {
      console.error("Error getting changes:", error);
      return [];
    }
  }
}
