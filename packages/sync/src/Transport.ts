import { Cursor, PeerMessage } from "./messages";

// Peer<=>Transport separation:
// - Peer can have many transports
// - Each transport can talk to many remote peers
// - Transport calls Peer's callbacks when new data comes in from remote
// - Peer calls transports' sync/send when it needs to send to remote
// - Transports manage connection states internally, Peer can't ask to reconnect, etc

// NOTE: Peer needs these callbacks to be serialized (called one by one, awaiting each call),
// to save every Transports from reimplementing serialization, that logic was built into the Peer.
// So transports are free to (seemingly) call the callbacks concurrently,
// but should know that internally those will be serialized, with unobvious 
// potential latency spikes from transport's POV.
export interface TransportCallbacks {
  // When remote peer connects, this will be called so Peer can sync,
  // if cb throws transport should reconnect after pause
  onConnect: (transport: Transport, peerId: string) => Promise<void>;
  // Received sync, so Peer could start tracking it and sending changes,
  // if cb throws transport should reconnect after pause
  onSync: (transport: Transport, peerId: string, peerCursor: Cursor) => Promise<void>;
  // Received msg from remote peer (change or eose),
  // if cb throws transport should reconnect after pause
  onReceive: (transport: Transport, peerId: string, msg: PeerMessage) => Promise<void>;
  // When remote peer is permanently disconnected, Peer should stop tracking it and
  // sending to it, cb shouldn't throw
  onDisconnect: (transport: Transport, peerId: string) => Promise<void>;
}

// NOTE: Peer's calls to sync/send aren't awaited and are executed with
// queueMicrotask - may be launched concurrently, etc. Transports
// have to implement serialization on their side if needed.
export interface Transport {
  // Must be called with peer.getConfig() as input, starts
  // the transport, connects to peers, etc
  start(config: { localPeerId: string } & TransportCallbacks): Promise<void>;
  // Request sync from peer, shouldn't throw unless invalid input,
  // shouldn't throw if peer temporarily disconnected
  sync(peerId: string, localCursor: Cursor): Promise<void>;
  // Send some changes to peer, shouldn't throw on transport
  // failures, only on invalid input, shouldn't throw if
  // peer temporarily disconnected
  send(peerId: string, changes: PeerMessage): Promise<void>;
}
