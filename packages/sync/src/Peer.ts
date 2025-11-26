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
    // NOTE: this is a slow method and if we await it,
    // we'll block all peer access (bcs onSync/onReceive are serialized),
    // so we don't await - there are no races in having
    // this method interleave with other callbacks
    this.syncPeer(peer);
  }

  private async onReceiveChanges(
    peerId: string,
    msg: PeerMessage,
    transport: Transport,
    cb?: (cursor: Cursor) => void
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
      // Apply to local db
      await this.applyChanges(newChanges);

      // We ourselves now know these new changes
      this.cursor = await this.getCurrentCursor();
      // NOTE: Updating cursor without checking from db
      // doesn't work: we don't know if some of incoming changes
      // are discarded due to newer changes in db from other peers,
      // that would cause our cursor to include non-existent peer id,
      // which will be broadcasted and will cause
      // hard-to-predict issues everywhere.
      // updateCursor(this.cursor, newChanges);

      this.debug(
        "Updated our cursor on remote changes",
        JSON.stringify(serializeCursor(this.cursor))
      );

      // Notify clients
      this.emitChanges(newChanges);

      // Forward to other peers
      await this.broadcastChanges(newChanges, peerId);
    }

    if (cb) cb(this.cursor);
  }

  private async onReceiveEOSE(
    peerId: string,
    msg: PeerMessage,
    transport: Transport,
    cb?: (cursor: Cursor) => void
  ): Promise<void> {
    this.debug(`Got EOSE message peer '${peerId}'`);
    this.emit("eose", peerId, transport);
    if (cb) cb(this.cursor);
  }

  private async onReceive(
    transport: Transport,
    peerId: string,
    msg: PeerMessage,
    cb?: (cursor: Cursor) => void
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
        return await this.onReceiveChanges(peerId, msg, transport, cb);
      case "eose":
        return await this.onReceiveEOSE(peerId, msg, transport, cb);
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
      // Larger batch doesn't improve timing on desktop
      const batches = chunk(deserializeChanges(changes), 2000);
      for (const batch of batches) {
        const start = Date.now();
        await this.db.tx(async (tx: DBInterface) => {
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

          // for (const change of batch) {
          //   await tx.exec(
          //     `INSERT INTO crsql_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          //     [
          //       change.table,
          //       change.pk,
          //       change.cid,
          //       change.val,
          //       change.col_version,
          //       change.db_version,
          //       change.site_id,
          //       change.cl,
          //       change.seq,
          //     ]
          //   );
          // }
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

      // Initialize cursor using the optimized method
      this.cursor = await this.getCurrentCursor();

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

  /**
   * Alternative method to get current cursor using __crsql_clock tables
   * instead of the slow GROUP BY on crsql_changes table.
   *
   * It's a replacement of slow naive:
   * SELECT site_id, MAX(db_version) as db_version FROM crsql_changes GROUP BY site_id
   *
   * Had to look at https://github.com/vlcn-io/cr-sqlite/blob/main/core/rs/core/src/changes_vtab_read.rs
   * and crsqlite internal tables to figure this out.
   */
  private async getCurrentCursor(): Promise<Cursor> {
    try {
      const start = Date.now();
      const cursor = new Cursor();

      // Step 1: Find all tables whose names end with __crsql_clock
      const clockTables = await this.db.execO<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%__crsql_clock'"
      );

      if (!clockTables || clockTables.length === 0) {
        this.debug("No __crsql_clock tables found");
        return cursor;
      }

      this.debug(`Found ${clockTables.length} __crsql_clock tables`);

      // Step 2 & 3: For each clock table, get site_id_int and MAX(db_version), build map A
      const siteIdIntToMaxDbVersion = new Map<number, number>();

      for (const table of clockTables) {
        const tableName = table.name;
        const clockData = await this.db.execO<{
          site_id: number;
          db_version: number;
        }>(
          `SELECT site_id, MAX(db_version) as db_version FROM "${tableName}" GROUP BY site_id`
        );

        if (clockData) {
          for (const row of clockData) {
            const existing = siteIdIntToMaxDbVersion.get(row.site_id) || 0;
            siteIdIntToMaxDbVersion.set(
              row.site_id,
              Math.max(existing, row.db_version)
            );
          }
        }
      }

      this.debug(
        `Built site_id_int map with ${siteIdIntToMaxDbVersion.size} entries`
      );

      // Step 4: Get ordinal -> site_id mapping from crsql_site_id table
      const ordinalToSiteId = await this.db.execO<{
        ordinal: number;
        site_id: Uint8Array;
      }>("SELECT ordinal, site_id FROM crsql_site_id");

      // Step 5: Convert map A to final map using ordinal mapping
      if (ordinalToSiteId) {
        for (const row of ordinalToSiteId) {
          const maxDbVersion = siteIdIntToMaxDbVersion.get(row.ordinal);
          if (maxDbVersion !== undefined) {
            const siteIdHex = bytesToHex(row.site_id);
            cursor.peers.set(siteIdHex, maxDbVersion);
          }
        }
      }

      if (!cursor.peers.size) cursor.peers.set(this.id, 0);

      this.debug(
        `getCurrentCursor completed in ${
          Date.now() - start
        } ms, cursor: ${JSON.stringify(serializeCursor(cursor))}`
      );

      return cursor;
    } catch (error) {
      this.debug("Error in getCurrentCursor:", error);
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

      const newChanges = filterChanges(changes, p.cursor);
      this.sendChanges(p, newChanges);
    }
  }

  // NOTE: this method might interleave with execution of
  // other callbacks, so it should be careful to avoid races
  // when modifying state members, the only case right now
  // is updatePeerCursor which is safe to call in any
  // order and thus seems race-free.
  private async syncPeer(peer: PeerInfo): Promise<void> {
    try {
      this.debug(
        `Syncing peer ${peer.id} cursor ${JSON.stringify(
          serializeCursor(peer.cursor)
        )}`
      );
      const start = Date.now();

      // for each site_id:db_version of peer cursor,
      // fetch known changes since then,
      // plus all changes from third-parties not known to peer,
      // and send to peer

      const changes: PeerChange[] = [];

      // Collect changes since known peer cursor
      let sql = "SELECT * FROM crsql_changes WHERE 0";
      const args = [];
      for (const [site_id, db_version] of peer.cursor.peers.entries()) {
        sql += " OR (site_id = ? AND db_version > ?)";
        args.push(hexToBytes(site_id));
        args.push(db_version);
      }

      // Collect changes from third-parties that peer didn't know about
      const excludePeerIds = [...new Set([peer.id, ...peer.cursor.peers.keys()])].map(
        (site_id) => hexToBytes(site_id)
      );
      const bindString = new Array(excludePeerIds.length).fill("?").join(",");
      sql += ` OR site_id NOT IN (${bindString})`;
      args.push(...excludePeerIds);

      const dbChanges = await this.db.execO<Change>(sql, args);

      if (dbChanges) changes.push(...serializeChanges(dbChanges));

      this.debug(
        "Collected changes for peer",
        peer.id,
        "changes",
        changes.length,
        "in",
        Date.now() - start,
        "ms"
      );

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
      console.log("older cursor", id, av, bv);
      return true;
    }
  }
  // a covers all b's peers, and a's versions are not less
  return false;
}
