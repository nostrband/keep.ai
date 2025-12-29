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
import { EventEmitter } from "tseep/lib/ee-safe.js";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { Transport } from "./Transport";

interface PeerInfo {
  id: string;
  cursor: Cursor;
  // whether we received onSync for this peer
  active: boolean;
  // transport used by this peer
  transport: Transport;
  // stream IDs for sending and receiving
  sendStreamId: string;
  recvStreamId: string;
  // cancel sync?
  syncCancel?: boolean;
  // to cancel and await
  syncPromise?: Promise<void>;
  // changes that happened while syncPeer was working
  pendingChanges: PeerChange[];
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

  // Calls to this method are serialized internally
  // to make sure we're only checking in 1 thread
  public checkLocalChanges: () => Promise<void>;

  constructor(db: DBInterface | (() => DBInterface), transports: Transport[]) {
    super();
    this.#db = db;
    this.transports = transports;
    this.checkLocalChanges = this.queued(this.checkLocalChangesImpl.bind(this));
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
  // Exposed as checkLocalChanges (see above) 
  // through serialization with 'queued'
  private async checkLocalChangesImpl(): Promise<void> {
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
      sendStreamId: "",
      recvStreamId: "",
      pendingChanges: [],
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
        const recvStreamId = await transport.sync(peerId, this.cursor);
        peer.recvStreamId = recvStreamId;
      } catch (e) {
        this.debug("Sync error with peer", peerId, "cursor", this.cursor, e);
      }
    });
  }

  private async onSync(
    transport: Transport,
    peerId: string,
    sendStreamId: string,
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
      throw new Error("Wrong transport for peer");
    }

    // Cancel existing sync
    if (peer.syncPromise) {
      peer.syncCancel = true;
      await peer.syncPromise;
    }

    // set it's cursor and send stream ID
    peer.cursor = peerCursor;
    peer.sendStreamId = sendStreamId;

    // Notify about peer sync start
    this.emit("sync", peerId, transport);

    // send changes since cursor
    // NOTE: this is a slow method and if we await it,
    // we'll block all peer access (bcs onSync/onReceive are serialized),
    // so we don't await - there are no races in having
    // this method interleave with other callbacks
    peer.syncPromise = this.syncPeer(peer);
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

    // Peer schema newer?
    if ((msg.schemaVersion || 0) > this.schemaVersion) {
      this.debug(
        `Ignoring updates from peer '${peerId}', need schema update ${this.schemaVersion} => ${msg.schemaVersion}`
      );
      this.emit("outdated", msg.schemaVersion!, peerId, transport);
      return;
    }

    // Stuff we haven't yet seen
    const newChanges = filterChanges(msg.data, this.cursor);

    // Assume peer knows everything they sent us,
    // only update with newChanges as some might have been overwritten
    // already
    this.updatePeerCursor(peerId, newChanges);

    this.debug(
      `Applying from peer '${peerId}' new changes ${newChanges.length} out of ${
        msg.data.length
      } cursor ${JSON.stringify(serializeCursor(this.cursor))}`
    );

    if (newChanges.length) {
      // Apply to local db (this now includes writing to crsql_change_history atomically)
      await this.applyChanges(newChanges);

      // We ourselves now know these new changes
      updateCursor(this.cursor, newChanges);
      this.debug(
        "Updated our cursor on remote changes",
        JSON.stringify(serializeCursor(this.cursor))
      );

      // Write cursor to all_peers table
      await this.writeCursor();

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
    recvStreamId: string,
    msg: PeerMessage
  ): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      console.error("onReceive for unknown peer", peerId);
      throw new Error("Peer not found");
    }
    if (peer.transport !== transport) {
      console.error("onReceive wrong transport for peer", peerId);
      throw new Error("Wrong transport for peer");
    }

    // Ignore input if recv stream id doesn't match current one
    if (recvStreamId !== peer.recvStreamId) {
      this.debug(
        `Ignoring message from peer ${peerId}: stream ID mismatch (expected ${peer.recvStreamId}, got ${recvStreamId})`
      );
      return;
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
    const start = Date.now();
    for (let i = 0; i < changes.length; i++) {
      try {
        this.validateChange(changes[i]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid change at index ${i}: ${message}`);
      }
    }

    // helper
    function chunk<T>(array: T[], size: number) {
      const result = [];
      for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
      }
      return result;
    }

    try {
      // Larger batch doesn't improve timing on desktop browser
      const batches = chunk(deserializeChanges(changes), 2000);
      const changeBatches = chunk(changes, 2000);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const changeBatch = changeBatches[i];
        const start = Date.now();

        await this.db.tx(async (tx: DBInterface) => {
          // Apply changes to crsql_changes
          await tx.execManyArgs(
            `INSERT INTO crsql_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            batch.map((change) => [
              change.table,
              change.pk,
              change.cid,
              change.val,
              change.col_version,
              change.db_version,
              change.site_id,
              change.cl,
              change.seq,
            ])
          );

          // Atomically write to crsql_change_history in the same transaction
          await this.writeChangesToHistory(changeBatch, tx);
        });

        this.debug(
          `Applied batch of size ${batch.length} in ${Date.now() - start} ms`
        );
      }
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
      // Get peer ID first so we can initialize debug logger
      const siteId = await this.db.execO<{ site_id: Uint8Array }>(
        "SELECT crsql_site_id() as site_id;"
      );
      this.#id = bytesToHex(siteId?.[0]?.site_id || new Uint8Array());
      this.#debug = debug("sync:Peer:L" + this.id.substring(0, 4));
      this.debug(`Initialized our peer id to ${this.id}`);

      // Initialize our own cursor
      this.cursor = await this.readCursor();
      this.debug(`Initialized our cursor to ${JSON.stringify(serializeCursor(this.cursor))}`);

      // Db version
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

  /**
   * Get current cursor using our optimized all_peers table.
   * This is much faster than the original slow query on crsql_changes virtual table.
   */
  private async readCursor(): Promise<Cursor> {
    try {
      const start = Date.now();
      const cursor = new Cursor();

      // Use our all_peers table for fast cursor lookup
      let cursorData = await this.db.execO<{
        site_id: Uint8Array;
        db_version: number;
      }>("SELECT site_id, db_version FROM all_peers");

      // Ensure our own peer is in the cursor, even if no changes yet
      if (!cursorData || !cursorData.length) {
        cursorData = await this.db.execO<{
          site_id: Uint8Array;
          db_version: number;
        }>(
          "SELECT distinct site_id as site_id, max(db_version) as db_version FROM crsql_change_history"
        );

        // distinct return null columns on empty table
        if (cursorData?.length === 1 && cursorData[0].site_id === null) {
          cursorData = null;
        }
      }

      if (cursorData) {
        for (const row of cursorData) {
          const siteIdHex = bytesToHex(row.site_id);
          cursor.peers.set(siteIdHex, row.db_version);
        }
      }

      this.debug(
        `readCursor completed in ${
          Date.now() - start
        } ms, cursor: ${JSON.stringify(serializeCursor(cursor))}`
      );

      return cursor;
    } catch (error) {
      this.debug("Error in readCursor:", error);
      throw error;
    }
  }

  /**
   * Write current cursor state to all_peers table.
   * This ensures the table is always up-to-date with the complete site_id:db_version map.
   */
  private async writeCursor(): Promise<void> {
    try {
      const start = Date.now();

      // Convert cursor to array of [site_id_bytes, db_version] for execManyArgs
      const cursorEntries: [Uint8Array, number][] = [];
      for (const [siteIdHex, dbVersion] of this.cursor.peers.entries()) {
        cursorEntries.push([hexToBytes(siteIdHex), dbVersion]);
      }

      if (cursorEntries.length === 0) return;

      await this.db.tx(async (tx) => {
        // Clear existing entries and insert current cursor state
        await tx.exec("DELETE FROM all_peers");
        await tx.execManyArgs(
          "INSERT INTO all_peers (site_id, db_version) VALUES (?, ?)",
          cursorEntries
        );
      });

      this.debug(
        `writeCursor completed in ${Date.now() - start} ms, written ${
          cursorEntries.length
        } entries`
      );
    } catch (error) {
      this.debug("Error in writeCursor:", error);
      throw error;
    }
  }

  /**
   * Write changes to crsql_change_history table for fast queries.
   * This maintains a copy of changes for performance optimization.
   */
  private async writeChangesToHistory(
    changes: PeerChange[],
    tx?: DBInterface
  ): Promise<void> {
    if (changes.length === 0) return;

    try {
      const start = Date.now();

      // Convert changes to the format needed for crsql_change_history
      const historyEntries: [
        string,
        Uint8Array,
        string,
        any,
        number,
        number,
        Uint8Array,
        number,
        number
      ][] = [];
      for (const change of changes) {
        historyEntries.push([
          change.table,
          hexToBytes(change.pk),
          change.cid,
          change.val,
          change.col_version,
          change.db_version,
          hexToBytes(change.site_id),
          change.cl,
          change.seq,
        ]);
      }

      const exec = async (tx: DBInterface) => {
        // Use provided transaction for atomic writes
        await tx.execManyArgs(
          `INSERT INTO crsql_change_history (\`table\`, pk, cid, val, col_version, db_version, site_id, cl, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          historyEntries
        );
      };

      if (tx) {
        await exec(tx);
      } else {
        // Create new transaction if none provided
        await this.db.tx((tx) => exec(tx));
      }

      this.debug(
        `writeChangesToHistory completed in ${Date.now() - start} ms, written ${
          historyEntries.length
        } entries`
      );
    } catch (error) {
      this.debug("Error in writeChangesToHistory:", error);
      throw error;
    }
  }

  private async broadcastLocalChanges(): Promise<void> {
    if (!this.isStarted) return;
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

        // Write new changes to history
        await this.writeChangesToHistory(changes);

        // Write cursor to all_peers table
        await this.writeCursor();

        // Notify clients before broadcasting
        this.emitChanges(changes);

        // Send to peers
        await this.broadcastChanges(changes);
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

  private async sendToPeer(peer: PeerInfo, msg: PeerMessage) {
    // React on backpressure if transport supports that
    if (peer.transport.waitCanSend) await peer.transport.waitCanSend();

    // Making sure transport.send can't synchronously
    // call Peer's callbacks
    queueMicrotask(async () => {
      try {
        await peer.transport.send(peer.id, peer.sendStreamId, msg);
      } catch (e) {
        this.debug("Send error with peer", peer.id, "msg", msg, e);
      }
    });
  }

  private async sendChanges(peer: PeerInfo, changes: PeerChange[]) {
    await this.sendToPeer(peer, {
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
      if (p.id === exceptPeerId) continue;

      if (!p.active) {
        p.pendingChanges.push(...changes);
        continue;
      }

      if (p.pendingChanges.length) {
        await this.sendChanges(p, p.pendingChanges);
        p.pendingChanges.length = 0;
      }

      const newChanges = filterChanges(changes, p.cursor);
      await this.sendChanges(p, newChanges);
    }
  }

  // NOTE: this method might interleave with execution of
  // other callbacks, so it should be careful to avoid races
  // when modifying state members, the only case right now
  // is updatePeerCursor which is safe to call in any
  // order and thus seems race-free.
  private async syncPeer(peer: PeerInfo): Promise<void> {
    peer.syncCancel = false;
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

      // Copy the peer's site_id:db_version map
      const map = new Map(peer.cursor.peers);

      // Add site_ids peer doesn't know about w/ db_version=0
      for (const site_id of this.cursor.peers.keys()) {
        if (!map.has(site_id)) map.set(site_id, 0);
      }

      // Collect changes since known peer cursor
      let sql =
        "SELECT `table`, pk, cid, val, col_version, db_version, site_id, cl, seq FROM crsql_change_history WHERE ";
      const args = [];
      for (const [site_id, db_version] of map.entries()) {
        if (args.length) sql += " OR ";
        // db_version >= (or EQUALS) to make sure we deliver full changes per tx
        // FIXME: look into ensuring tx delivery by organizing change batches properly
        sql += "(site_id = ? AND db_version > ?)";
        args.push(hexToBytes(site_id));
        args.push(db_version);
      }

      // Offset+limit might require defined order
      sql += " ORDER BY site_id, db_version ";

      this.debug("Collecting changes with crsql_change_history", sql, args);

      // Batch the query to avoid SQLite limits with large result sets
      const batchSize = 10000;
      let offset = 0;
      let totalChanges = 0;

      while (!peer.syncCancel) {
        const batchSql = `${sql} LIMIT ? OFFSET ?`;
        const batchArgs = [...args, batchSize, offset];

        const start = Date.now();
        this.debug(`Fetching batch: offset=${offset}, limit=${batchSize}`);
        const dbChangesBatch = await this.db.execO<Change>(batchSql, batchArgs);

        if (!dbChangesBatch || dbChangesBatch.length === 0) {
          break; // No more results
        }

        const changes = serializeChanges(dbChangesBatch);
        this.debug(
          "Collected changes batch for peer",
          peer.id,
          "changes",
          changes.length,
          "offset",
          offset,
          "in",
          Date.now() - start,
          "ms"
        );

        // Convert to peer changes
        this.debug(`Sync to peer '${peer.id}' changes ${changes.length}`);

        // Send to peer
        await this.sendChanges(peer, changes);

        // Assume peer knows these changes now
        this.updatePeerCursor(peer.id, changes);

        totalChanges += dbChangesBatch.length;

        // If we got fewer results than the batch size, we're done
        if (dbChangesBatch.length < batchSize) {
          break;
        }

        offset += batchSize;
      }

      if (!peer.syncCancel) {
        if (!totalChanges) this.debug(`No changes to sync for peer ${peer.id}`);

        // Send EOSE
        await this.sendToPeer(peer, {
          type: "eose",
          data: [],
        });
        this.debug(`Sent to peer '${peer.id}' EOSE`);
      } else {
        this.debug(`Sync cancelled to peer '${peer.id}'`);
      }

      // Send pending changes that have been or are being 
      // added by checkLocalChanges while active=false
      while (peer.pendingChanges.length) {
        // Consume
        const changes = [...peer.pendingChanges];
        peer.pendingChanges.length = 0;

        // Send to peer
        await this.sendChanges(peer, changes);

        // Assume peer knows these changes now
        this.updatePeerCursor(peer.id, changes);
      }

      // Now checkLocalChanges will send by itself
      peer.active = true;

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

export function filterChanges(changes: PeerChange[], cursor: Cursor) {
  return changes.filter((c) => {
    const lastDbVersion = cursor.peers.get(c.site_id) || 0;
    // "Or equal" bcs one tx with same db version might be split
    // into several change records
    return c.db_version >= lastDbVersion;
  });
}

export function isCursorOlder(a: Cursor, b: Cursor) {
  for (const [id, bv] of b.peers.entries()) {
    const av = a.peers.get(id);
    // a has no info on this id?
    // or a has older version than b?
    if (av === undefined || av < bv) {
      // console.log("older cursor", id, av, bv);
      return true;
    }
  }
  // a covers all b's peers, and a's versions are not less
  return false;
}
