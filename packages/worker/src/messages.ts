
export interface Change {
  table: string;
  pk: Uint8Array;
  cid: string;
  val: any;
  col_version: number;
  db_version: number;
  site_id: Uint8Array;
  cl: number;
  seq: number;
}

export interface WorkerMessage {
  type: "sync" | "exec";
  data?: any;
  sql?: string;
  args?: any[];
  requestId?: string;
}

export interface WorkerResponse {
  type: "sync-data" | "error" | "exec-reply" | "ready";
  changes?: Change[];
  error?: string;
  result?: any;
  requestId?: string;
  siteId?: Uint8Array;
}

export interface BroadcastMessage {
  type: "changes";
  data: Change[];
}