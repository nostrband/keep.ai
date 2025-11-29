/**
 * CR-Sqlite sync over Nostr:
 *
 * Events:
 * - CURSOR - contains our cursor for peer to know when to start the stream
 * - CHANGES - contains changes + link to prev CHANGES event + link to CURSOR event
 *
 * Cursors:
 * - both peers maintain 2 sets of cursors: send & recv.
 * - send is initialized from peer's CURSOR event
 * - send tracks which cursor we've already sent, used to call onSync when we're restarting
 * - send is reset if peer publishes new CURSOR event asking us to reset our stream
 * - recv is initialized from first sync(cursor) call by our db
 * - recv tracks which cursor we've already received, used to fetch newer changes and call onReceive
 * - recv is reset if sync(cursor) is called with older cursor, will publish a new CURSOR event
 *
 * Stream:
 * - CHANGES events form a single-linked list (new event links to prev one)
 * - tags: r - CURSOR stream id, e? - prev CHANGES event id (empty on first event in stream)
 * - created_at of CHANGES events must always increase (same timestamp not allowed for 2 events)
 * - peer starts downloading from newest CHANGES and tracks previous one by 'r' tag
 * - if prev one isn't found, stream is considered broken and new CURSOR must be published to request new stream
 *
 * Both CURSOR and CHANGES are encrypted with nip44. No visible links exist between parties' events,
 * they don't tag each other, CURSOR has encrypted 'stream_id' which is then tagged in CHANGES, so it's unclear which
 * pubkey the changes are targeting.
 */

import { SimplePool, Event, Filter, UnsignedEvent } from "nostr-tools";
import { Transport, TransportCallbacks } from "../Transport";
import {
  Cursor,
  deserializeCursor,
  PeerChange,
  PeerMessage,
  SerializableCursor,
  serializeCursor,
} from "../messages";
import { NostrPeer, NostrPeerStore } from "@app/db";
import debug from "debug";
import { KIND_CHANGES, KIND_CURSOR, publish } from ".";
import { SubCloser } from "nostr-tools/abstract-pool";
import { isCursorOlder, updateCursor } from "../Peer";
import { bytesToHex } from "nostr-tools/utils";
import { randomBytes } from "@noble/hashes/utils";

const MAX_RECV_BUFFER_SIZE = 10000;
const MAX_BATCH_BYTES = 200000;

// Signer, connecting the transport with key storage
export interface NostrSigner {
  // NOTE: event.pubkey must be set to choose matching key
  signEvent(event: UnsignedEvent): Promise<Event>;
  encrypt(req: {
    plaintext: string;
    receiverPubkey: string; // encrypt for them
    senderPubkey: string; // signer must have matching privkey
  }): Promise<string>;
  decrypt(req: {
    ciphertext: string;
    receiverPubkey: string; // signer must have matching privkey
    senderPubkey: string; // sender encrypted it
  }): Promise<string>;
}

interface CursorPayload {
  peer_id: string;
  stream_id: string;
  cursor: SerializableCursor;
}

interface ChangesPayload {
  peer_id: string;
  msg: PeerMessage;
}

export class NostrTransport implements Transport {
  public readonly store: NostrPeerStore;
  public readonly signer: NostrSigner;
  public readonly pool: SimplePool;
  public readonly expiryPeriod: number;
  #localPeerId?: string;
  private callbacks?: TransportCallbacks;
  private peers: NostrPeer[] = [];
  private sends = new Map<string, PeerSend>();
  private recvs = new Map<string, PeerRecv>();
  #debug?: ReturnType<typeof debug>;
  private isExternalPool: boolean;

  constructor({
    store,
    signer,
    pool,
    expiryPeriod = 7 * 24 * 3600,
  }: {
    store: NostrPeerStore;
    signer: NostrSigner;
    pool?: SimplePool;
    expiryPeriod?: number;
  }) {
    this.store = store;
    this.signer = signer;
    this.pool =
      pool ||
      new SimplePool({
        enablePing: true,
        enableReconnect: true,
      });
    this.isExternalPool = !!pool;
    this.expiryPeriod = expiryPeriod;
  }

  get debug() {
    if (!this.#debug) throw new Error("Not started yet");
    return this.#debug;
  }

  get localPeerId() {
    if (!this.#localPeerId)
      throw new Error("Not started yet, no local peer id");
    return this.#localPeerId;
  }

  onSync(peerId: string, peerCursor: Cursor) {
    return this.callbacks!.onSync(this, peerId, peerCursor);
  }

  onReceive(peerId: string, msg: PeerMessage, cb?: (cursor: Cursor) => void) {
    return this.callbacks!.onReceive(this, peerId, msg, cb);
  }

  async start(
    config: { localPeerId: string } & TransportCallbacks
  ): Promise<void> {
    this.#localPeerId = config.localPeerId;
    this.callbacks = config;
    this.#debug = debug("sync:Nostr:" + config.localPeerId.substring(0, 4));
    this.debug("Starting...");

    this.updatePeers();
  }

  async updatePeers() {
    // All peers, event connected to different device
    const allPeers = await this.store.listPeers();

    // Peers connected to our device/db
    const peers = allPeers.filter((p) => p.local_id === this.localPeerId);
    this.debug("Peers", peers.length);

    // Find removed peers, match by pubkey - we might connect
    // multiple times to the same device, thus have same peer_id but different
    // peer_pubkey
    const removedPeers = this.peers.filter(
      (peer) => !peers.find((p) => p.peer_pubkey === peer.peer_pubkey)
    );

    // Update the stored peer list
    this.peers = peers;

    // Stop removed peers
    for (const p of removedPeers) {
      // Notify
      this.callbacks!.onDisconnect(this, p.peer_id);

      // Stop the send/recv sides
      await this.sends.get(p.peer_id)!.stop();
      await this.recvs.get(p.peer_id)!.stop();
    }

    // Now ensure all peers are initialized
    for (const p of peers) {
      // Already started
      if (this.sends.get(p.peer_id)) continue;

      const send = new PeerSend(this, p);
      const recv = new PeerRecv(this, p);
      this.sends.set(p.peer_id, send);
      this.recvs.set(p.peer_id, recv);

      // Notify the peer, will result in recv.sync() that starts receiving
      await this.callbacks!.onConnect(this, p.peer_id);

      // Manually start the sending side
      await send.start();
    }
  }

  async reconnect() {
    this.debug("Reconnecting peers", this.peers.length);
    for (const p of this.sends.values()) p.reconnect();
    for (const p of this.recvs.values()) p.reconnect();
  }

  async sync(peerId: string, localCursor: Cursor): Promise<void> {
    const recv = this.recvs.get(peerId);
    if (!recv) throw new Error("Peer not found " + peerId);
    return recv.sync(localCursor);
  }

  async send(peerId: string, changes: PeerMessage): Promise<void> {
    const send = this.sends.get(peerId);
    if (!send) throw new Error("Peer not found " + peerId);
    return send.send(changes);
  }

  async stop() {
    for (const r of this.recvs.values()) await r.stop();
    for (const s of this.sends.values()) await s.stop();
    // Only destroy the pool if it's not external
    if (!this.isExternalPool) {
      this.pool.destroy();
    }
  }
}

interface RecvCursor {
  recv_cursor: Cursor;
  recv_cursor_id: string;
  recv_changes_event_id: string;
  recv_changes_timestamp: number;
}

interface RecvMessage {
  event_id: string;
  prev_event_id: string;
  created_at: number;
  msg: PeerMessage;
}

class PeerRecv {
  public readonly peer: NostrPeer;
  public readonly relays: string[];
  private readonly parent: NostrTransport;
  private localCursor?: Cursor;
  private sub?: SubCloser;
  private recvCursor?: RecvCursor;
  private buffer = new Map<string, RecvMessage>();
  private processBufferPromise?: Promise<void>;
  private debug: ReturnType<typeof debug>;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private resyncTimer?: ReturnType<typeof setTimeout>;

  constructor(parent: NostrTransport, peer: NostrPeer) {
    this.peer = peer;
    this.parent = parent;
    this.relays = this.peer.relays.split(",");
    if (!this.relays.length) throw new Error("No relays for PeerRecv");
    this.debug = debug(
      "sync:Nostr:Recv:L" +
        this.parent.localPeerId.substring(0, 4) +
        ":P" +
        this.peer.peer_id.substring(0, 4)
    );
  }

  async reconnect() {
    // Not started yet
    if (!this.localCursor || !this.sub) return;

    // Clear scheduled reconnect
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = undefined;

    // Clear current sub
    const sub = this.sub;
    this.sub = undefined;

    // Close old sub
    sub.close();

    await this.subscribe();
  }

  async sync(localCursor: Cursor): Promise<void> {
    if (this.localCursor) throw new Error("Already syncing");

    // Store for future reference
    this.localCursor = localCursor;

    // Read our recv cursor from db
    await this.readRecvCursor();

    // Need to ask peer to resync from our cursor
    const havePublishedCursor = await this.havePublishedCursor();
    const needResync =
      !this.recvCursor ||
      isCursorOlder(this.localCursor, this.recvCursor.recv_cursor) ||
      !havePublishedCursor;

    if (needResync) {
      if (this.recvCursor)
        this.debug("Need resync from peer", this.peer.peer_pubkey, {
          local: JSON.stringify([...this.localCursor.peers.entries()]),
          stored: JSON.stringify([
            ...this.recvCursor.recv_cursor.peers.entries(),
          ]),
          published: havePublishedCursor,
        });
      // No cursor or stream interrupted?
      // (Re-)publish the CURSOR event and subscribe
      await this.resync();
    } else {
      // Subscribe to proceed with existing CURSOR event
      await this.subscribe();
    }
  }

  private async havePublishedCursor() {
    const events = await this.parent.pool.querySync(
      this.relays,
      {
        kinds: [KIND_CURSOR],
        authors: [this.peer.local_pubkey],
        limit: 1,
      },
      {
        maxWait: 10000,
      }
    );
    return events.length > 0;
  }

  private async fetch(filter: Filter) {
    let until: number | undefined;
    let buffer: Event[] = [];
    do {
      const events = await this.parent.pool.querySync(
        this.relays,
        {
          ...filter,
          until,
        },
        {
          maxWait: 10000,
        }
      );
      if (!events.length) {
        // We expect the first event and none were published yet? That's ok
        if (!buffer.length && !this.recvCursor!.recv_changes_event_id)
          return [];

        // We got some events but haven't found the next one
        break;
      }

      // Ensure sort order
      events.sort((a, b) => b.created_at - a.created_at);

      // Find the next expected event index
      const lastIndex = events.findIndex((e) => {
        return e.id === this.recvCursor!.recv_changes_event_id;
      });
      this.debug(
        "Changes from peer",
        this.peer.peer_pubkey,
        "batch",
        events.length,
        "total",
        buffer.length + events.length,
        "last",
        lastIndex
      );

      // Got it? Append everything up to last event to buffer
      if (lastIndex >= 0) {
        buffer.push(...events.slice(0, lastIndex));
        return buffer;
      }

      // Push everything to buffer and proceed
      buffer.push(...events);

      // Next fetch until the oldest timestamp
      until = events.at(-1)!.created_at - 1;

      // Do not go crazy, >10k events should result in re-sync
    } while (buffer.length < MAX_RECV_BUFFER_SIZE);

    // Return everything if we don't have 'last-known' changes event
    if (!this.recvCursor!.recv_changes_event_id) return buffer;

    this.debug(
      "Failed to find next change event for peer",
      this.peer.peer_pubkey
    );
    return undefined;
  }

  private async subscribe() {
    if (this.sub) throw new Error("Already subscribed");
    if (!this.recvCursor || !this.recvCursor.recv_cursor_id)
      throw new Error("Last cursor event id empty");

    // Changes filter
    const filter: Filter = {
      kinds: [KIND_CHANGES],
      authors: [this.peer.peer_pubkey],
      "#r": [this.recvCursor.recv_cursor_id],
      limit: 500,
    };
    // Changes must have non-decreasing timestamp
    if (this.recvCursor.recv_changes_timestamp)
      filter.since = this.recvCursor.recv_changes_timestamp;

    // Fetch events already stored on relays
    const storedEvents = await this.fetch(filter);
    this.debug(
      "Stored events from peer",
      this.peer.peer_pubkey,
      "events",
      storedEvents?.length,
      "stream",
      this.recvCursor.recv_cursor_id
    );
    if (!storedEvents) {
      // Stream interrupted
      return this.restart();
    }

    // Decrypt stored events and put them to buffer
    for (const e of storedEvents) await this.handleChangesEvent(e);

    // Wait until they're all processed
    await this.processBuffer();

    // Send EOSE after we've handled all stored events
    await this.parent.onReceive(this.peer.peer_id, {
      type: "eose",
      data: [],
    });

    // Subscribe for future events
    if (this.recvCursor.recv_changes_timestamp)
      filter.since = this.recvCursor.recv_changes_timestamp;
    const sub = this.parent.pool.subscribeMany(this.relays, filter, {
      onclose: async (reasons) => {
        this.debug("Relays closed sub", filter, reasons);

        // Still current sub & not scheduled a reconnect?
        if (this.sub === sub && !this.reconnectTimeout)
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = undefined;
            this.reconnect();
          }, 5000);
      },
      onevent: async (e) => {
        await this.handleChangesEvent(e);

        // Launch processing loop if not working yet
        if (!this.processBufferPromise) this.processBuffer();
      },
    });

    // Make it current
    this.sub = sub;
  }

  private async processBuffer() {
    const promise = new Promise<void>(async (ok, rej) => {
      try {
        // Check buffer size
        if (this.buffer.size >= MAX_RECV_BUFFER_SIZE) {
          this.debug(
            "Too many buffered events, restarting for peer",
            this.peer.peer_pubkey
          );

          // Async restart
          this.restart();
          return;
        }

        do {
          // Aborted?
          if (!this.recvCursor) break;

          const next = this.buffer.get(this.recvCursor.recv_changes_event_id);
          if (!next) break;

          // Take next one from buffer
          this.buffer.delete(next.prev_event_id);

          // Process it
          await this.processMessage(next);

          // While not aborted
        } while (this.recvCursor && this.buffer.size);

        // Drop old messages from buffer
        if (this.recvCursor) {
          for (const [k, m] of this.buffer.entries()) {
            if (m.created_at < this.recvCursor.recv_changes_timestamp)
              this.buffer.delete(k);
          }
        }

        ok();
      } catch (e) {
        rej(e);
      }
    });

    // Store the promise, and make sure it clears itself
    // from 'this' after it finishes
    this.processBufferPromise = promise;
    promise.finally(() => {
      if (promise === this.processBufferPromise)
        this.processBufferPromise = undefined;
    });

    return promise;
  }

  private async handleChangesEvent(event: Event) {
    if (event.pubkey !== this.peer.peer_pubkey) {
      this.debug(
        "Ignoring changes from",
        event.pubkey,
        "expected",
        this.peer.peer_pubkey
      );
      return;
    }

    if (!this.recvCursor) {
      this.debug("Ignoring changes from", event.pubkey, " - no recv cursor");
      return;
    }

    try {
      const decryptedContent = await this.parent.signer.decrypt({
        ciphertext: event.content,
        receiverPubkey: this.peer.local_pubkey,
        senderPubkey: this.peer.peer_pubkey,
      });
      const payload: ChangesPayload = JSON.parse(decryptedContent);
      if (payload.peer_id !== this.peer.peer_id)
        throw new Error("Wrong peer id in changes");

      const prev_event_id = tv(event, "e") || "";

      this.debug(
        "Recv changes from peer",
        this.peer.peer_pubkey,
        "eid",
        event.id,
        "prev",
        prev_event_id,
        "changes",
        payload.msg.data.length
      );

      // Final check to make sure we aren't aborted
      const cursor_event_id = tv(event, "r");
      if (cursor_event_id !== this.recvCursor!.recv_cursor_id) {
        this.debug(
          "Ignoring changes from",
          event.pubkey,
          "cursor",
          cursor_event_id,
          "expected",
          this.recvCursor!.recv_cursor_id
        );
        return;
      }

      // Put to buffer
      this.buffer.set(prev_event_id, {
        event_id: event.id,
        prev_event_id,
        created_at: event.created_at,
        msg: payload.msg,
      });
    } catch (e) {
      this.debug(
        "Bad changes event from peer",
        this.peer.peer_pubkey,
        event,
        e
      );
      this.restart();
    }
  }

  private async processMessage(msg: RecvMessage) {
    // Aborted
    if (!this.recvCursor) return;

    this.debug("Processing changes", JSON.stringify(msg));

    try {
      // Notify the Peer
      const newCursor = await new Promise<Cursor>((ok) =>
        this.parent.onReceive(this.peer.peer_id, msg.msg, ok)
      );

      // NOTE: this doesn't work, bcs some of site_id:db_version pairs
      // from msg might have been discarded by our db, in which
      // case that site_id might disappear entirely from db,
      // but we'd keep tracking it in recv_cursor, causing resync on
      // every restart due to 'old' local cursor (db missing discarded site_id)
      // updateCursor(this.recvCursor.recv_cursor, msg.msg.data);

      // Update cursor and last event id
      this.recvCursor.recv_cursor = newCursor;
      this.recvCursor.recv_changes_event_id = msg.event_id;
      this.recvCursor.recv_changes_timestamp = msg.created_at;

      // Write the new cursor info
      await this.writeRecvCursor();
    } catch (e) {
      this.debug(
        "Abort, failed to process changes from peer",
        this.peer.peer_pubkey,
        msg,
        e
      );

      // Make no sense to restart, we have to figure out the issue, otherwise
      // we'll be sending changes back and forth and failing in an infinite loop.
      // Do not await - it will recursively await on itself
      this.abort();
    }
  }

  private async restart() {
    this.debug("Restarting recv from peer", this.peer.peer_pubkey);
    await this.abort();
    try {
      await this.resync();
    } catch (e) {
      this.debug("Abort, failed to restart for peer", this.peer.peer_pubkey);

      // Can't restart, will stay aborted
      await this.abort();
    }
  }

  // Does not throw, aborts the relay subscription and message processing loop,
  // resets the cursor and buffer
  private async abort() {
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    this.resyncTimer = undefined;

    // Stop the sub asap
    if (this.sub) this.sub.close();
    this.sub = undefined;

    // Drop the buffer to signal 'abort' to processMessages
    this.buffer.clear();

    // Await for it to finish properly
    if (this.processBufferPromise) {
      try {
        await this.processBufferPromise;
      } catch (e) {
        this.debug("Error processing buffer while aborting", e);
      }
    }

    // Reset cursor
    this.recvCursor = undefined;
  }

  private async resync() {
    if (!this.localCursor) throw new Error("No local cursor");

    // Random stream id
    const stream_id = bytesToHex(randomBytes(16));
    this.debug("Resync for peer", this.peer.peer_pubkey, "stream", stream_id);

    // Encrypted payload
    const payload: CursorPayload = {
      peer_id: this.parent.localPeerId,
      stream_id,
      cursor: serializeCursor(this.localCursor),
    };

    // Encrypt for peer
    const content = await this.parent.signer.encrypt({
      plaintext: JSON.stringify(payload),
      receiverPubkey: this.peer.peer_pubkey,
      senderPubkey: this.peer.local_pubkey,
    });
    // Prepare event, it's replaceable - new one will overwrite existing one
    const cursorEvent: UnsignedEvent = {
      kind: KIND_CURSOR,
      pubkey: this.peer.local_pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content,
    };
    // Sign
    this.debug(
      "Signing cursor for peer",
      this.peer.peer_pubkey,
      "by local pubkey",
      this.peer.local_pubkey
    );
    const signedEvent = await this.parent.signer.signEvent(cursorEvent);

    // Publish to relays
    try {
      await publish(signedEvent, this.parent.pool, this.relays);
    } catch (e) {
      this.debug("Failed to resync, will retry, ", e);

      // Retry later
      if (!this.resyncTimer) {
        this.resyncTimer = setTimeout(() => {
          this.resyncTimer = undefined;
          if (this.localCursor) this.resync();
        }, 10000);
      }

      // Stop, we can't subscribe yet
      return;
    }

    this.debug(
      "Sent cursor to peer",
      this.peer.peer_pubkey,
      "cursor",
      JSON.stringify(serializeCursor(this.localCursor)),
      "event id",
      signedEvent.id
    );

    // Init recv cursor
    this.recvCursor = {
      recv_cursor: this.localCursor,
      recv_cursor_id: stream_id,
      recv_changes_event_id: "",
      recv_changes_timestamp: 0,
    };

    // Write the new cursor info
    await this.writeRecvCursor();

    // Subscribe with new cursor
    await this.subscribe();
  }

  private async readRecvCursor() {
    // Peer sync state
    const c = await this.parent.store.getNostrPeerCursorRecv(
      this.peer.peer_pubkey
    );
    if (!c || !c.recv_cursor) return;
    this.debug(
      "Read recv cursor for peer",
      this.peer.peer_pubkey,
      "stream",
      c.recv_cursor_id,
      c.recv_cursor,
      c.recv_changes_event_id
    );

    try {
      const recv_cursor = deserializeCursor(JSON.parse(c.recv_cursor));
      this.recvCursor = {
        recv_cursor,
        recv_cursor_id: c.recv_cursor_id,
        recv_changes_event_id: c.recv_changes_event_id,
        recv_changes_timestamp: c.recv_changes_timestamp,
      };
    } catch (e) {
      this.debug("Bad last cursor", c?.recv_cursor, e);
    }
  }

  private async writeRecvCursor() {
    if (!this.recvCursor) throw new Error("No recv cursor");
    const recv_cursor = JSON.stringify(
      serializeCursor(this.recvCursor.recv_cursor)
    );
    this.debug(
      "Write recv cursor for peer",
      this.peer.peer_pubkey,
      "stream",
      this.recvCursor.recv_cursor_id,
      recv_cursor
    );
    await this.parent.store.setNostrPeerCursorRecv({
      peer_pubkey: this.peer.peer_pubkey,
      recv_cursor,
      recv_cursor_id: this.recvCursor.recv_cursor_id,
      recv_changes_event_id: this.recvCursor.recv_changes_event_id,
      recv_changes_timestamp: this.recvCursor.recv_changes_timestamp,
    });
  }

  async stop() {
    await this.abort();
  }
}

interface SendCursor {
  send_cursor: Cursor;
  send_cursor_id: string;
  send_changes_event_id: string;
  send_changes_timestamp: number;
}

class PeerSend {
  public readonly peer: NostrPeer;
  public readonly relays: string[];
  private readonly parent: NostrTransport;
  private sendCursor?: SendCursor;
  private sub?: SubCloser;
  private debug: ReturnType<typeof debug>;
  private pending: PeerChange[] = [];
  private schemaVersion: number = 0;
  private lastCursorCreatedAt = 0;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private nextSendTimer?: ReturnType<typeof setTimeout>;

  constructor(parent: NostrTransport, peer: NostrPeer) {
    this.peer = peer;
    this.parent = parent;
    this.relays = this.peer.relays.split(",");
    if (!this.relays.length) throw new Error("No relays for PeerSend");
    this.debug = debug(
      "sync:Nostr:Send:L" +
        this.parent.localPeerId.substring(0, 4) +
        ":P" +
        this.peer.peer_id.substring(0, 4)
    );
  }

  async start() {
    // Recover our stream state
    await this.readSendCursor();

    // Subscribe to CURSOR events by receiver
    await this.subscribe();
  }

  async stop() {
    if (this.sub) this.sub.close();
    this.sub = undefined;
    this.sendCursor = undefined;
    if (this.nextSendTimer) clearTimeout(this.nextSendTimer);
    this.nextSendTimer = undefined;
    this.pending.length = 0;
    this.schemaVersion = 0;
    this.lastCursorCreatedAt = 0;
  }

  async reconnect() {
    // Not connected yet
    if (!this.sub) return;

    // Make sure scheduled reconnect is cancelled
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = undefined;

    // Clear current sub
    const sub = this.sub;
    this.sub = undefined;

    // Close old sub
    sub.close();

    await this.subscribe(true); // reconnect
  }

  private async subscribe(reconnect = false) {
    const filter: Filter = {
      kinds: [KIND_CURSOR],
      authors: [this.peer.peer_pubkey],
    };

    // Subscribe for cursor events
    const sub = this.parent.pool.subscribeMany(this.relays, filter, {
      onclose: async (reasons) => {
        this.debug("Relays closed sub", filter, reasons);

        // Still current sub & not scheduled a reconnect?
        if (this.sub === sub && !this.reconnectTimeout)
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = undefined;
            this.reconnect();
          }, 5000);
      },
      onevent: async (e) => {
        this.debug("New cursor event by", this.peer.peer_pubkey, e);
        // ignore old events
        if (e.created_at < this.lastCursorCreatedAt) return;

        const { valid, restart } = await this.handleCursorEvent(e);
        this.debug("New cursor event by", this.peer.peer_pubkey, {
          valid,
          restart,
        });
        if (valid) this.lastCursorCreatedAt = e.created_at;

        if (restart)
          this.parent.onSync(this.peer.peer_id, this.sendCursor!.send_cursor);
      },
    });

    // Make this sub current
    this.sub = sub;

    // Have stored cursor on first start? Launch immediately
    if (this.sendCursor && !reconnect)
      this.parent.onSync(this.peer.peer_id, this.sendCursor.send_cursor);
  }

  private async handleCursorEvent(event: Event) {
    if (event.pubkey !== this.peer.peer_pubkey) {
      this.debug(
        "Ignoring cursor from",
        event.pubkey,
        "expected",
        this.peer.peer_pubkey
      );
      return {
        valid: false,
        restart: false,
      };
    }

    try {
      const decryptedContent = await this.parent.signer.decrypt({
        ciphertext: event.content,
        receiverPubkey: this.peer.local_pubkey,
        senderPubkey: this.peer.peer_pubkey,
      });
      const payload: CursorPayload = JSON.parse(decryptedContent);
      if (payload.peer_id !== this.peer.peer_id)
        throw new Error("Wrong peer id in cursor");

      // Same cursor? Ok, we'll proceed with our stream
      if (
        this.sendCursor &&
        this.sendCursor.send_cursor_id === payload.stream_id
      ) {
        this.debug(
          "Reuse send cursor for peer",
          this.peer.peer_pubkey,
          "stream",
          payload.stream_id,
          this.sendCursor
        );
        return {
          valid: true,
          restart: false,
        };
      } else {
        // New cursor
        this.sendCursor = {
          send_cursor: deserializeCursor(payload.cursor),
          send_cursor_id: payload.stream_id,
          send_changes_event_id: "",
          send_changes_timestamp: 0,
        };
        this.debug(
          "New send cursor for peer",
          this.peer.peer_pubkey,
          "stream",
          payload.stream_id,
          this.sendCursor
        );
        return {
          valid: true,
          restart: true,
        };
      }
    } catch (e) {
      this.debug("Bad cursor event from peer", this.peer.peer_pubkey, event, e);
    }

    return {
      valid: false,
      restart: false,
    };
  }

  async send(changes: PeerMessage): Promise<void> {
    if (!this.sendCursor) throw new Error("No send cursor");

    // Do not send 'EOSE', we have synthetic event for that
    if (changes.type === "eose") return;

    // Put to send queue
    this.schemaVersion = Math.max(
      this.schemaVersion,
      changes.schemaVersion || 0
    );
    this.schedule(changes.data);
  }

  private schedule(data: PeerChange[]) {
    this.pending.push(...data);
    if (!this.nextSendTimer) {
      // Schedule next send in 100 ms
      this.nextSendTimer = setTimeout(async () => {
        await this.publishPending();

        // Reset after sending
        this.nextSendTimer = undefined;
      }, 100);
    }
  }

  private async publishPending() {
    // Split all changes into messages of ~20kb size
    let batches: PeerMessage[] = [];
    let batch: PeerMessage | undefined;
    let size = 0;
    for (const c of this.pending) {
      const nextSize =
        c.cid.length +
        c.pk.length +
        c.site_id.length +
        c.table.length +
        (c.val?.length || 0);
      // console.log("val", typeof c.val, c.val?.length, nextSize);

      if (batch && size + nextSize >= MAX_BATCH_BYTES) {
        batches.push(batch);
        batch = undefined;
        size = 0;
      }

      if (!batch) {
        batch = {
          type: "changes",
          schemaVersion: this.schemaVersion,
          data: [c],
        };
      } else {
        batch.data.push(c);
      }

      size += nextSize;
    }
    if (batch) batches.push(batch);

    this.debug(
      "Split changes",
      this.pending.length,
      "into batches",
      batches.length
    );

    // Clear the buffer
    this.pending.length = 0;

    // Send batches, watch for stop signal
    while (batches.length) {
      const msg = batches.shift()!;

      const ok = await this.publish(msg);

      // Aborted?
      if (!this.sendCursor) break;

      if (!ok) {
        this.debug(
          "Will retry publish changes",
          msg.data.length,
          "and batches",
          batches.length
        );

        // Put msg and remaining batches back to pending
        this.pending.push(...msg.data);
        this.pending.push(...batches.map((b) => b.data).flat());

        // If the next publish is scheduled
        if (this.nextSendTimer) clearTimeout(this.nextSendTimer);

        // Schedule next try in 10 sec
        this.nextSendTimer = setTimeout(async () => {
          await this.publishPending();

          // Reset after sending
          this.nextSendTimer = undefined;
        }, 10000);
        break;
      }
    }
  }

  private async publish(msg: PeerMessage) {
    if (!this.sendCursor) throw new Error("No send cursor");

    const payload: ChangesPayload = {
      peer_id: this.parent.localPeerId!,
      msg,
    };

    this.debug(
      "Encrypting content size",
      JSON.stringify(msg).length,
      "batch",
      msg.data.length
    );

    // Encrypt the message
    const content = await this.parent.signer.encrypt({
      plaintext: JSON.stringify(payload),
      receiverPubkey: this.peer.peer_pubkey,
      senderPubkey: this.peer.local_pubkey,
    });

    // Aborted?
    if (!this.sendCursor) return;

    this.debug(
      "Encrypted content size",
      content.length,
      "batch",
      msg.data.length
    );

    // Prepare nostr event
    const now = Math.floor(Date.now() / 1000);
    const changesEvent: UnsignedEvent = {
      kind: KIND_CHANGES,
      pubkey: this.peer.local_pubkey,
      created_at: now,
      tags: [
        ["r", this.sendCursor.send_cursor_id],
        ["expiration", (now + this.parent.expiryPeriod).toString()],
        ...(this.sendCursor.send_changes_event_id
          ? [["e", this.sendCursor.send_changes_event_id]]
          : []),
      ],
      content,
    };

    // Ensure the timestamp never goes back
    if (changesEvent.created_at < this.sendCursor.send_changes_timestamp)
      changesEvent.created_at = this.sendCursor.send_changes_timestamp;

    this.debug(
      "Signing changes for peer",
      this.peer.peer_pubkey,
      "by local pubkey",
      this.peer.local_pubkey,
      "relays",
      this.relays
    );
    const signedEvent = await this.parent.signer.signEvent(changesEvent);

    // Publish to all relays
    try {
      await publish(signedEvent, this.parent.pool, this.relays);
    } catch (e) {
      this.debug("Failed to publish changes", e);
      return false;
    }

    this.debug(
      "Sent to peer",
      this.peer.peer_pubkey,
      "changes",
      msg.data.length,
      "event",
      signedEvent.id,
      "stream",
      this.sendCursor.send_cursor_id
    );

    // If not aborted
    if (this.sendCursor) {
      // Advance peer cursor
      updateCursor(this.sendCursor.send_cursor, msg.data);
      this.sendCursor.send_changes_event_id = signedEvent.id;
      this.sendCursor.send_changes_timestamp = signedEvent.created_at;

      // Write to db
      await this.writeSendCursor();
    }

    return true;
  }

  private async readSendCursor() {
    // Peer sync state
    const c = await this.parent.store.getNostrPeerCursorSend(
      this.peer.peer_pubkey
    );
    if (!c || !c.send_cursor) return;
    this.debug(
      "Read send cursor for peer",
      this.peer.peer_pubkey,
      "stream",
      c.send_cursor_id,
      c.send_cursor
    );

    try {
      const send_cursor = deserializeCursor(JSON.parse(c.send_cursor));
      this.sendCursor = {
        send_cursor,
        send_cursor_id: c.send_cursor_id,
        send_changes_event_id: c.send_changes_event_id,
        send_changes_timestamp: c.send_changes_timestamp,
      };
    } catch (e) {
      this.debug("Bad last cursor", c?.send_cursor, e);
    }
  }

  private async writeSendCursor() {
    if (!this.sendCursor) throw new Error("No send cursor");
    const send_cursor = JSON.stringify(
      serializeCursor(this.sendCursor.send_cursor)
    );
    this.debug(
      "Write send cursor for peer",
      this.peer.peer_pubkey,
      "stream",
      this.sendCursor.send_cursor_id,
      send_cursor
    );
    await this.parent.store.setNostrPeerCursorSend({
      peer_pubkey: this.peer.peer_pubkey,
      send_cursor,
      send_cursor_id: this.sendCursor.send_cursor_id,
      send_changes_event_id: this.sendCursor.send_changes_event_id,
      send_changes_timestamp: this.sendCursor.send_changes_timestamp,
    });
  }
}

function tv(e: Event, tag: string) {
  return e.tags.find((t) => t.length >= 2 && t[0] === tag)?.[1];
}
