import { bytesToHex, hexToBytes } from "nostr-tools/utils";

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
  schemaVersion?: number;
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

export function serializeChanges(changes: Change[]): PeerChange[] {
  return changes.map((change) => ({
    ...change,
    pk: bytesToHex(change.pk),
    site_id: bytesToHex(change.site_id),
  }));
}

export function deserializeChanges(changes: PeerChange[]): Change[] {
  return changes.map((change) => ({
    ...change,
    pk: hexToBytes(change.pk),
    site_id: hexToBytes(change.site_id),
  }));
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

