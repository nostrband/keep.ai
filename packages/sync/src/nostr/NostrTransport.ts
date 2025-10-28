import {
  SimplePool,
  getPublicKey,
  nip44,
  Event,
  Filter,
  UnsignedEvent,
} from "nostr-tools";
import { Transport, TransportCallbacks } from "../Transport";
import {
  Cursor,
  deserializeCursor,
  PeerChange,
  PeerMessage,
  SerializableCursor,
  serializeCursor,
} from "../messages";
import { NostrPeer, NostrPeerCursor, NostrPeerStore } from "packages/db/dist";
import debug from "debug";
import { KIND_CHANGES, KIND_CURSOR } from ".";

const debugNostrTransport = debug("sync:NostrTransport");

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
  cursor: SerializableCursor;
}

interface ChangesPayload {
  peer_id: string;
  msg: PeerMessage;
}

export class NostrTransport implements Transport {
  #store?: NostrPeerStore;
  private signer: NostrSigner;
  private pool: SimplePool = new SimplePool();
  private localPeerId?: string;
  private callbacks?: TransportCallbacks;
  private peers: NostrPeer[] = [];

  constructor(store: NostrPeerStore, signer: NostrSigner) {
    this.#store = store;
    this.signer = signer;
  }

  get store() {
    if (!this.#store) throw new Error("Store required");
    return this.#store;
  }

  async start(
    config: { localPeerId: string } & TransportCallbacks
  ): Promise<void> {
    this.localPeerId = config.localPeerId;
    this.callbacks = config;

    // Init connect on all peers
    this.peers = await this.store.listPeers();
    for (const p of this.peers) {
      this.callbacks!.onConnect(this, p.peer_id);
    }

    // FIXME fetch CURSOR events by peers,
    // update nostr peer cursors if those have changed
  }

  async sync(peerId: string, localCursor: Cursor): Promise<void> {
    const peer = this.peers.find((p) => p.peer_id === peerId);
    if (!peer) throw new Error("Peer not found " + peerId);

    // Peer sync state
    const nostrPeerCursor = await this.store.getNostrPeerCursor(
      peer.peer_pubkey
    );
    let lastCursor: Cursor | undefined;
    let lastCursorEventId: string | undefined;
    try {
      if (nostrPeerCursor) {
        lastCursor = deserializeCursor(JSON.parse(nostrPeerCursor.last_cursor));
        lastCursorEventId = nostrPeerCursor.last_cursor_event_id;
      }
    } catch (e) {
      debugNostrTransport("Bad last cursor", nostrPeerCursor?.last_cursor, e);
    }

    // Need to ask peer to resync from our cursor
    let needResync = !lastCursor || isCursorLess(localCursor, lastCursor);

    // Can proceed fetching since last cursor event?
    if (!needResync) {
      if (!lastCursorEventId) throw new Error("Last cursor event id empty");
      const filter: Filter = {
        kinds: [KIND_CURSOR],
        "#p": [peer.connection_pubkey],
        "#e": [lastCursorEventId],
      };

      // fetch all CHANGES events from relays up until last_changes_event_id,

      // if not found - publish new CURSOR event and update in db,
      // if found - process loaded events one by one from oldest to newest:
      // - call onReceive on the changes
      // - write last_changes_event_id after processed
    }

    // No cursor or stream interrupted?
    if (needResync) {
      await this.resync(peer, nostrPeerCursor, localCursor);
    }
  }

  async send(peerId: string, changes: PeerMessage): Promise<void> {
    const peer = this.peers.find((p) => p.peer_id === peerId);
    if (!peer) throw new Error("Peer not found " + peerId);

    // Peer sync state
    const nostrPeerCursor = await this.store.getNostrPeerCursor(
      peer.peer_pubkey
    );
    if (!nostrPeerCursor)
      throw new Error("No nostr peer cursor for " + peer.peer_pubkey);

    const peerCursor = deserializeCursor(
      JSON.parse(nostrPeerCursor.peer_cursor)
    );

    // FIXME split changes into batches < 20Kb

    const payload: ChangesPayload = {
      peer_id: this.localPeerId!,
      msg: changes,
    };

    // Encrypt the message
    const content = await this.signer.encrypt({
      plaintext: JSON.stringify(payload),
      receiverPubkey: peer.peer_pubkey,
      senderPubkey: peer.connection_pubkey,
    });

    // Prepare nostr event
    const changesEvent: UnsignedEvent = {
      kind: KIND_CHANGES,
      pubkey: peer.connection_pubkey,
      created_at: Math.floor(Date.now() / 10000),
      tags: [
        ["p", peer.peer_pubkey],
        ["e", nostrPeerCursor.peer_cursor_event_id],
      ],
      content,
    };
    const signedEvent = await this.signer.signEvent(changesEvent);

    // Publish to all relays
    await Promise.all(this.pool.publish(peer.relays.split(","), signedEvent));

    // Advance peer cursor
    const newCursor = applyChangeToCursor(peerCursor, changes.data);

    // Write the updated cursor event info
    const newNostrPeerCursor: NostrPeerCursor = {
      ...nostrPeerCursor,
      peer_cursor: JSON.stringify(serializeCursor(newCursor)),
      peer_changes_event_id: signedEvent.id,
    };
    await this.store.setNostrPeerCursor(newNostrPeerCursor);
  }

  private async resync(
    peer: NostrPeer,
    nostrPeerCursor: NostrPeerCursor | null,
    localCursor: Cursor
  ) {
    const payload: CursorPayload = {
      peer_id: this.localPeerId!,
      cursor: serializeCursor(localCursor),
    };
    const content = await this.signer.encrypt({
      plaintext: JSON.stringify(payload),
      receiverPubkey: peer.peer_pubkey,
      senderPubkey: peer.connection_pubkey,
    });
    const cursorEvent: UnsignedEvent = {
      kind: KIND_CURSOR,
      pubkey: peer.connection_pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", peer.peer_pubkey]],
      content,
    };
    const signedEvent = await this.signer.signEvent(cursorEvent);

    // Publish to all relays
    await Promise.all(this.pool.publish(peer.relays.split(","), signedEvent));

    // Write the new cursor event info
    const newNostrPeerCursor: NostrPeerCursor = {
      ...(nostrPeerCursor || {
        last_changes_event_id: "",
        peer_changes_event_id: "",
        peer_cursor: "",
        peer_cursor_event_id: "",
      }),
      peer_pubkey: peer.peer_pubkey,
      last_cursor: JSON.stringify(serializeCursor(localCursor)),
      last_cursor_event_id: signedEvent.id,
    };

    await this.store.setNostrPeerCursor(newNostrPeerCursor);
  }
}
