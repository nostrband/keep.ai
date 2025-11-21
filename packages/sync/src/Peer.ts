/**
 * CRSqlite sync:
 * - cr-sqlite tracks update cursors automatically for each peer
 * - our job is to exchange messages with peers to achieve good sync
 * - different transports are supported (MessagePort, HTTP, Nostr)
 * - workflow for each peer:
 *  - connect to known peers
 *  - send/recv 'sync' request with cursor (site_id:db_version map)
 *  - track cursor for each peer (what they know)
 *  - recv changes since our cursor, ended with EOSE (end of stored events)
 *  - recv further changes as they come
 *  - forward received changes to peers according to their cursors
 *  - when local changes detected - send to all peers
 *  - disconnect - no more updates received
 */

import { DBInterface } from "@app/db";
import {
  PeerMessage,
  Change,
  PeerChange,
  Cursor,
  serializeCursor,
  serializeChanges,
  deserializeChanges,
} from "./messages";
import debug from "debug";
import { EventEmitter } from "tseep/lib/ee-safe";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { Transport } from "./Transport";

interface PeerInfo {
  id: string;
  cursor: Cursor;
  // whether we received onSync for this peer
  active: boolean;
  // transport used by this peer
  transport: Transport;
}

export class Peer extends EventEmitter<{
  change: (tables: string[]) => void;
  connect: (peerId: string, transport: Transport) => void;
  sync: (peerId: string, transport: Transport) => void;
  eose: (peerId: string, transport: Transport) => void;
  outdated: (
    schemaVersion: number,
    peerId: string,
    transport: Transport
  ) => void;
}> {
  #db: DBInterface | (() => DBInterface);
  #id: string = "";
  #schemaVersion: number = 0;
  protected isStarted = false;
  private transports: Transport[];
  private cursor = new Cursor();
  private peers = new Map<string, PeerInfo>();
  private queue: Promise<void> = Promise.resolve();
  #debug?: ReturnType<typeof debug>;

  constructor(db: DBInterface | (() => DBInterface), transports: Transport[]) {
    super();
    this.#db = db;
    this.transports = transports;
  }

  get db(): DBInterface {
    return typeof this.#db === "function" ? this.#db() : this.#db;
  }

  get id(): string {
    return this.#id;
  }

  get schemaVersion(): number {
    return this.#schemaVersion;
  }

  private get debug() {
    if (!this.#debug) throw new Error("Debug not initialized");
    return this.#debug;
  }

  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    try {
      debug("sync:Peer")("Starting...");

      // Initialize last db version before starting to send messages
      await this.initialize();

      this.debug("Started successfully");
    } catch (error) {
      this.debug("Failed to start:", error);
      this.stop();
      throw error;
    }
  }

  // Config for transport
  getConfig() {
    if (!this.id) throw new Error("Config empty until start()");
    return {
      localPeerId: this.id,
      onConnect: this.queued(this.onConnect.bind(this)),
      onSync: this.queued(this.onSync.bind(this)),
      onReceive: this.queued(this.onReceive.bind(this)),
      onDisconnect: this.queued(this.onDisconnect.bind(this)),
    };
  }

  // If there are local changes:
  // - broadcasts to peers
  // - emits 'changes'
  async checkLocalChanges(): Promise<void> {
    await this.broadcastLocalChanges();
  }

  async stop(): Promise<void> {
    this.isStarted = false;
    this.cursor = new Cursor();
    this.#id = "";
    this.peers.clear();

    // Stop all transports if they have a stop method
    for (const transport of this.transports) {
      if ("stop" in transport && typeof transport.stop === "function") {
        try {
          await transport.stop();
        } catch (error) {
          this.debug("Error stopping transport:", error);
        }
      }
    }
  }

  private async onConnect(transport: Transport, peerId: string): Promise<void> {
    const peer: PeerInfo = {
      id: peerId,
      cursor: new Cursor(),
      active: false,
      transport: transport,
    };
    this.peers.set(peerId, peer);
    this.debug(`Peer '${peerId}' connected`);

    // Notify clients immediately before 'sync',
    // bcs sync might send "EOSE" immediately
    this.emit("connect", peerId, transport);

    // Start sync with peer, make sure this call can't
    // synchronously re-enter into Peer's callbacks
    queueMicrotask(async () => {
      try {
        await transport.sync(peerId, this.cursor);
      } catch (e) {
        this.debug("Sync error with peer", peerId, "cursor", this.cursor, e);
      }
    });
  }

  private async onSync(
    transport: Transport,
    peerId: string,
    peerCursor: Cursor
  ): Promise<void> {
    this.debug("onSync", peerId, peerCursor);
    const peer = this.peers.get(peerId);
    if (!peer) {
      console.error("onSync for unknown peer", peerId);
      throw new Error("Peer not found");
    }
    if (peer.transport !== transport) {
      console.error("onSync wrong transport for peer", peerId);
      throw new Error("Wrong transport for peerr");
    }

    // activate
    peer.active = true;

    // set it's cursor
    peer.cursor = peerCursor;

    // Notify about peer sync start
    this.emit("sync", peerId, transport);

    // send changes since cursor
    await this.syncPeer(peer);
  }

  private async onReceiveChanges(
    peerId: string,
    msg: PeerMessage,
    transport: Transport
  ): Promise<void> {
    // Apply everything peer sent us
    this.debug(
      `Received from peer '${peerId}' changes ${msg.data.length} schema ${msg.schemaVersion}`
    );

    // Assume peer knows everything they sent us
    this.updatePeerCursor(peerId, msg.data);

    // Peer schema newer?
    if ((msg.schemaVersion || 0) > this.schemaVersion) {
      this.debug(
        `Ignoring updates from peer '${peerId}', need schema update ${this.schemaVersion} => ${msg.schemaVersion}`
      );
      this.emit("outdated", msg.schemaVersion!, peerId, transport);
      return;
    }

    // Stuff we haven't yet seen
    const newChanges = msg.data.filter((c) => {
      const lastDbVersion = this.cursor.peers.get(c.site_id) || 0;
      // "Or equal" bcs one tx with save db version might be split
      // into several change records
      return c.db_version >= lastDbVersion;
    });

    this.debug(
      `Applying from peer '${peerId}' new changes ${newChanges.length} out of ${
        msg.data.length
      } cursor ${JSON.stringify(serializeCursor(this.cursor))}`
    );

    if (newChanges.length) {
      // Apply to local db
      await this.applyChanges(newChanges);

      // We ourselves now know these new changes
      updateCursor(this.cursor, newChanges);
      this.debug(
        "Updated our cursor on remote changes",
        JSON.stringify(serializeCursor(this.cursor))
      );

      // Notify clients
      this.emitChanges(newChanges);

      // Forward to other peers
      await this.broadcastChanges(newChanges, peerId);
    }
  }

  private async onReceiveEOSE(
    peerId: string,
    msg: PeerMessage,
    transport: Transport
  ): Promise<void> {
    this.debug(`Got EOSE message peer '${peerId}'`);
    this.emit("eose", peerId, transport);
  }

  private async onReceive(
    transport: Transport,
    peerId: string,
    msg: PeerMessage
  ): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      console.error("onSync for unknown peer", peerId);
      throw new Error("Peer not found");
    }
    if (peer.transport !== transport) {
      console.error("onSync wrong transport for peer", peerId);
      throw new Error("Wrong transport for peerr");
    }
    switch (msg.type) {
      case "changes":
        return await this.onReceiveChanges(peerId, msg, transport);
      case "eose":
        return await this.onReceiveEOSE(peerId, msg, transport);
      default:
        this.debug(`Got unknown message peer '${peerId}' type '${msg.type}'`);
    }
  }

  private async onDisconnect(
    transport: Transport,
    peerId: string
  ): Promise<void> {
    this.peers.delete(peerId);
    this.debug(`Peer '${peerId}' disconnected`);
  }

  private validateChange(change: any): asserts change is PeerChange {
    if (!change || typeof change !== "object") {
      throw new Error("Change must be an object");
    }

    // Required string fields
    if (typeof change.table !== "string" || !change.table.trim()) {
      throw new Error("Change.table must be a non-empty string");
    }
    if (typeof change.pk !== "string") {
      throw new Error("Change.pk must be a hex string");
    }
    if (typeof change.cid !== "string" || !change.cid.trim()) {
      throw new Error("Change.cid must be a non-empty string");
    }
    if (typeof change.site_id !== "string") {
      throw new Error("Change.site_id must be a hex string");
    }

    // Required numeric fields
    if (
      typeof change.col_version !== "number" ||
      !Number.isInteger(change.col_version) ||
      change.col_version < 0
    ) {
      throw new Error("Change.col_version must be a non-negative integer");
    }
    if (
      typeof change.db_version !== "number" ||
      !Number.isInteger(change.db_version) ||
      change.db_version < 0
    ) {
      throw new Error("Change.db_version must be a non-negative integer");
    }
    if (
      typeof change.cl !== "number" ||
      !Number.isInteger(change.cl) ||
      change.cl < 0
    ) {
      throw new Error("Change.cl must be a non-negative integer");
    }
    if (
      typeof change.seq !== "number" ||
      !Number.isInteger(change.seq) ||
      change.seq < 0
    ) {
      throw new Error("Change.seq must be a non-negative integer");
    }

    // Validate hex strings
    const hexPattern = /^[0-9a-fA-F]*$/;
    if (!hexPattern.test(change.pk)) {
      throw new Error("Change.pk must be a valid hex string");
    }
    if (!hexPattern.test(change.site_id)) {
      throw new Error("Change.site_id must be a valid hex string");
    }

    // Validate hex string lengths (must be even for valid byte conversion)
    if (change.pk.length % 2 !== 0) {
      throw new Error("Change.pk hex string must have even length");
    }
    if (change.site_id.length % 2 !== 0) {
      throw new Error("Change.site_id hex string must have even length");
    }

    // val can be any type (null, string, number, etc.) so no validation needed
  }

  private async applyChanges(changes: PeerChange[]): Promise<void> {
    if (changes.length === 0) return;

    // Validate all changes before applying any
    for (let i = 0; i < changes.length; i++) {
      try {
        this.validateChange(changes[i]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid change at index ${i}: ${message}`);
      }
    }

    try {
      // FIXME split into batches?
      const start = Date.now();
      await this.db.tx(async (tx: DBInterface) => {
        for (const change of deserializeChanges(changes)) {
          await tx.exec(
            `INSERT INTO crsql_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              change.table,
              change.pk,
              change.cid,
              change.val,
              change.col_version,
              change.db_version,
              change.site_id,
              change.cl,
              change.seq,
            ]
          );
        }
      });
      this.debug(
        `Successfully applied changes ${changes.length} in ${
          Date.now() - start
        } ms`
      );
    } catch (error) {
      this.debug("Error applying changes to database:", error);
      throw error;
    }
  }

  private emitChanges(changes: PeerChange[]) {
    const tables = new Set(changes.map((c) => c.table));
    if (tables.size) this.emit("change", [...tables]);
  }

  private async initialize(): Promise<void> {
    try {
      const cursorData = await this.db.execO<{
        site_id: Uint8Array;
        db_version: number;
      }>(
        "SELECT site_id, MAX(db_version) as db_version FROM crsql_changes GROUP BY site_id"
      );
      if (cursorData) {
        for (const c of cursorData)
          this.cursor.peers.set(bytesToHex(c.site_id), c.db_version);
      }

      const siteId = await this.db.execO<{ site_id: Uint8Array }>(
        "SELECT crsql_site_id() as site_id;"
      );
      this.#id = bytesToHex(siteId?.[0]?.site_id || new Uint8Array());
      this.#debug = debug("sync:Peer:L" + this.id.substring(0, 4));

      this.debug(
        `Initialized cursor to ${JSON.stringify(serializeCursor(this.cursor))}`
      );

      this.debug(`Initialized our peer id to ${this.id}`);

      const schemaVersion = await this.db.execO<{ user_version: number }>(
        "PRAGMA user_version;"
      );
      this.#schemaVersion = schemaVersion?.[0]?.user_version || 0;
      this.debug(`Initialized our schema version to ${this.schemaVersion}`);
    } catch (error) {
      console.error("Error initializing last db version:", error);
      throw error;
    }
  }

  private async broadcastLocalChanges(): Promise<void> {
    try {
      const lastDbVersion = this.cursor.peers.get(this.id) || 0;
      const dbChanges = await this.db.execO<Change>(
        "SELECT * FROM crsql_changes WHERE db_version > ? AND site_id = crsql_site_id()",
        [lastDbVersion]
      );

      // Convert to peer changes
      if (dbChanges && dbChanges.length > 0) {
        this.debug(
          `Broadcasting since version ${lastDbVersion} changes ${dbChanges.length}`
        );

        // Convert to network-friendly format
        const changes = serializeChanges(dbChanges);

        // Update our own cursor
        updateCursor(this.cursor, changes);
        this.debug(
          "Updated our cursor on local changes",
          JSON.stringify(serializeCursor(this.cursor))
        );

        // Send to everyone
        await this.broadcastChanges(changes);

        // Notify clients
        this.emitChanges(changes);
      }
    } catch (error) {
      this.debug("Error broadcasting changes:", error);
    }
  }

  private updatePeerCursor(peerId: string, changes: PeerChange[]) {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error("Unknown peer");

    // We know peer knows these changes
    updateCursor(peer.cursor, changes);

    this.debug(
      `Update cursor peer '${peerId}' cursor ${JSON.stringify(
        serializeCursor(peer.cursor)
      )}`
    );
  }

  private sendToPeer(peer: PeerInfo, msg: PeerMessage) {
    // Making sure transport.send can't synchronously
    // call Peer's callbacks
    queueMicrotask(async () => {
      try {
        await peer.transport.send(peer.id, msg);
      } catch (e) {
        this.debug("Send error with peer", peer.id, "msg", msg, e);
      }
    });
  }

  private sendChanges(peer: PeerInfo, changes: PeerChange[]) {
    this.sendToPeer(peer, {
      type: "changes",
      data: changes,
      schemaVersion: this.schemaVersion,
    });
    this.debug(`Sending to peer '${peer.id}' changes ${changes.length}`);
  }

  private async broadcastChanges(changes: PeerChange[], exceptPeerId?: string) {
    this.debug("Broadcasting to peers", this.peers.size);
    for (const p of this.peers.values()) {
      this.debug("Broadcasting to peer", p.id, p.active);
      if (p.id === exceptPeerId || !p.active) continue;

      const newChanges = changes.filter((c) => {
        const peerChangeDbVersion = p.cursor.peers.get(c.site_id) || 0;
        return c.db_version > peerChangeDbVersion;
      });

      this.sendChanges(p, newChanges);
    }
  }

  private async syncPeer(peer: PeerInfo): Promise<void> {
    try {
      this.debug(
        `Syncing peer ${peer.id} cursor ${JSON.stringify(
          serializeCursor(peer.cursor)
        )}`
      );
      // for each site_id:db_version of peer cursor,
      // fetch known changes since then,
      // plus all changes from third-parties not known to peer,
      // and send to peer

      const changes: PeerChange[] = [];

      // Collect changes since known peer cursor
      for (const [site_id, db_version] of peer.cursor.peers.entries()) {
        const dbChanges = await this.db.execO<Change>(
          "SELECT * FROM crsql_changes WHERE db_version > ? AND site_id = ?",
          [db_version, hexToBytes(site_id)]
        );

        if (dbChanges) changes.push(...serializeChanges(dbChanges));
      }

      // Collect changes from third-parties that peer didn't know about
      const excludePeerIds = [peer.id, ...peer.cursor.peers.keys()].map(
        (site_id) => hexToBytes(site_id)
      );
      const bindString = new Array(excludePeerIds.length).fill("?").join(",");
      const dbChanges = await this.db.execO<Change>(
        `SELECT * FROM crsql_changes WHERE site_id NOT IN (${bindString})`,
        [peer.id, ...peer.cursor.peers.keys()].map((site_id) =>
          hexToBytes(site_id)
        )
      );
      if (dbChanges) changes.push(...serializeChanges(dbChanges));

      // Convert to peer changes
      if (changes.length > 0) {
        this.debug(`Sync to peer '${peer.id}' changes ${changes.length}`);

        // Send to peer
        this.sendChanges(peer, changes);

        // Assume peer knows these changes now
        this.updatePeerCursor(peer.id, changes);
      } else {
        this.debug(`No changes to sync for peer ${peer.id}`);
      }

      // Send EOSE
      this.sendToPeer(peer, {
        type: "eose",
        data: [],
      });
      this.debug(`Sent to peer '${peer.id}' EOSE`);
    } catch (error) {
      this.debug("Error sending changes to", peer, error);
      throw error;
    }
  }

  // The magic by chatgpt, just a typesafe way to do this:
  // this.queue = this.queue.then(callback(args)).catch(logIt);
  // so that queued callbacks are always executed in a single-thread
  // and we avoid racy clients that might call our callbacks concurrently.
  private queued<T extends (...args: any[]) => any>(
    fn: T
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
    return (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      // This promise is what the *caller* of the wrapped function awaits
      let resolveResult: (value: Awaited<ReturnType<T>>) => void;
      let rejectResult: (reason?: unknown) => void;

      const resultPromise = new Promise<Awaited<ReturnType<T>>>(
        (resolve, reject) => {
          resolveResult = resolve;
          rejectResult = reject;
        }
      );

      // Chain onto the instance queue so calls are strictly serialized
      this.queue = this.queue
        .then(async () => {
          try {
            const value = await fn(...args);
            resolveResult!(value as Awaited<ReturnType<T>>);
          } catch (err) {
            rejectResult!(err);
            throw err; // propagate to .catch below so we can keep the queue healthy
          }
        })
        .catch((err) => {
          // Prevent the queue from staying in a rejected state.
          // You can swap this for your own logging.
          console.error("Error in queued callback:", err);
        });

      return resultPromise;
    };
  }
}

export function updateCursor(cursor: Cursor, changes: PeerChange[]) {
  for (const c of changes) {
    const db_version = cursor.peers.get(c.site_id) || 0;
    cursor.peers.set(c.site_id, Math.max(db_version, c.db_version));
  }
}

export function isCursorOlder(a: Cursor, b: Cursor) {
  for (const [id, bv] of b.peers.entries()) {
    const av = a.peers.get(id);
    // a has no info on this id?
    if (av === undefined) return true;
    // a has older version than b?
    if (av < bv) return true;
  }
  // a covers all b's peers, and a's versions are not less
  return false;
}
