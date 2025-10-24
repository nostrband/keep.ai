import { CRSqliteWorkerBase, WorkerResponsePort } from "./CRSqliteWorkerBase";
import { BroadcastMessage, WorkerMessage, WorkerResponse } from "./messages";
import { DBInterface } from "@app/db";

export class CRSqliteWorkerAPI extends CRSqliteWorkerBase {

  constructor(db: DBInterface | (() => DBInterface), onBroadcastChangesCallback: (msg: BroadcastMessage) => Promise<void>) {
    super(db, onBroadcastChangesCallback);
  }

  async sync(msg: WorkerMessage): Promise<WorkerResponse> {
    if (msg.type !== "sync") {
      throw new Error(`Expected message type 'sync', got '${msg.type}'`);
    }

    // Create a mock port to capture the response
    let response: WorkerResponse | null = null;
    await this.processClientMessage(msg, {
      postMessage: (res) => {
        response = res;
      }
    });
    return response!;
  }

  async exec(msg: WorkerMessage): Promise<WorkerResponse> {
    if (msg.type !== "exec") {
      throw new Error(`Expected message type 'exec', got '${msg.type}'`);
    }

    // Create a mock port to capture the response
    let response: WorkerResponse | null = null;
    await this.processClientMessage(msg, {
      postMessage: (res) => {
        response = res;
      }
    });
    return response!;
  }

  async changes(msg: BroadcastMessage): Promise<void> {
    await this.processChanges(msg);
  }
}