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

export interface PeerChange {
  table: string;
  pk: string; // hex
  cid: string;
  val: any; // always network-friendly
  col_version: number;
  db_version: number;
  site_id: string; // hex
  cl: number;
  seq: number;
}

export interface PeerMessage {
  type: "changes" | "eose";
  data: PeerChange[];
}

export interface SerializableCursor {
  peers: Record<string, number>; // Map<string, number> serialized as object
}

export interface TransportMessage {
  type: "connect" | "disconnect" | "sync" | "data" | "ping" | "error";
  peerId: string;
  data?: PeerMessage; // only if type === "data"
  cursor?: SerializableCursor; // only if type === "sync"

  // for network transports
  token?: string;
  error?: string;
}

// Serializable version of Change with Uint8Array fields converted to number[]
export interface SerializableChange {
  table: string;
  pk: number[];
  cid: string;
  val: any;
  col_version: number;
  db_version: number;
  site_id: number[];
  cl: number;
  seq: number;
}

// Serializable version of BroadcastMessage
export interface SerializableBroadcastMessage {
  type: "changes";
  data: SerializableChange[];
}

// Serializable version of WorkerResponse
export interface SerializableWorkerResponse {
  type: "sync-data" | "error" | "exec-reply" | "ready";
  changes?: SerializableChange[];
  error?: string;
  result?: any;
  requestId?: string;
  siteId?: number[];
}

function serializeChanges(changes: Change[]) {
  return changes.map((change) => ({
    ...change,
    pk: Array.from(change.pk),
    site_id: Array.from(change.site_id),
  }));
}

function deserializeChanges(changes: SerializableChange[]) {
  return changes.map((change) => ({
    ...change,
    pk: new Uint8Array(change.pk),
    site_id: new Uint8Array(change.site_id),
  }));
}

/**
 * Serializes a BroadcastMessage by converting Uint8Array fields to number[] arrays
 * and then stringifying the result for transmission.
 */
export function serializeBroadcastMessage(msg: BroadcastMessage): string {
  const serializableMsg: SerializableBroadcastMessage = {
    ...msg,
    data: serializeChanges(msg.data),
  };

  return JSON.stringify(serializableMsg);
}

/**
 * Deserializes a stringified BroadcastMessage by parsing the JSON and converting
 * number[] arrays back to Uint8Array fields.
 */
export function deserializeBroadcastMessage(
  serialized: string | SerializableBroadcastMessage
): BroadcastMessage {
  const parsed: SerializableBroadcastMessage =
    typeof serialized === "string" ? JSON.parse(serialized) : serialized;

  const msg: BroadcastMessage = {
    ...parsed,
    data: deserializeChanges(parsed.data),
  };

  return msg;
}

export function serializeWorkerResponse(msg: WorkerResponse): string {
  const serializableMsg: SerializableWorkerResponse = {
    ...msg,
    siteId: msg.siteId ? Array.from(msg.siteId) : undefined,
    changes: msg.changes ? serializeChanges(msg.changes) : undefined,
  };

  return JSON.stringify(serializableMsg);
}

export function deserializeWorkerResponse(
  serialized: string | SerializableWorkerResponse
): WorkerResponse {
  const parsed: SerializableWorkerResponse =
    typeof serialized === "string" ? JSON.parse(serialized) : serialized;

  const msg: WorkerResponse = {
    ...parsed,
    siteId: parsed.siteId ? new Uint8Array(parsed.siteId) : undefined,
    changes: parsed.changes ? deserializeChanges(parsed.changes) : undefined,
  };

  return msg;
}

export class Cursor {
  peers = new Map<string, number>();
}

// Helper functions for cursor serialization
export function serializeCursor(cursor: Cursor): SerializableCursor {
  const peers: Record<string, number> = {};
  for (const [key, value] of cursor.peers.entries()) {
    peers[key] = value;
  }
  return { peers };
}

export function deserializeCursor(serializable: SerializableCursor): Cursor {
  const cursor = new Cursor();
  for (const [key, value] of Object.entries(serializable.peers)) {
    cursor.peers.set(key, value);
  }
  return cursor;
}

