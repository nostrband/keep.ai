import { Cursor, PeerMessage } from "./messages";

export interface TransportCallbacks {
  // When peer connects, this will be called so you can sync,
  // if cb throws transport should reconnect after pause
  onConnect: (transport: Transport, peerId: string) => Promise<void>;
  // Received sync, so we could start tracking it and sending changes,
  // if cb throws transport should reconnect after pause
  onSync: (transport: Transport, peerId: string, peerCursor: Cursor) => Promise<void>;
  // Received msg from peer (change or eose),
  // if cb throws transport should reconnect after pause
  onReceive: (transport: Transport, peerId: string, msg: PeerMessage) => Promise<void>;
  // When peer disconnects we should stop tracking it and
  // sending to it, cb shouldn't throw
  onDisconnect: (transport: Transport, peerId: string) => Promise<void>;
}

export interface Transport {
  // Must be called with peer.getConfig() as input, starts
  // the transport, connects to peers, etc
  start(config: { localPeerId: string } & TransportCallbacks): Promise<void>;
  // Request sync from peer, shouldn't throw unless invalid input,
  // shouldn't throw if peer is not connected
  sync(peerId: string, localCursor: Cursor): Promise<void>;
  // Send some changes to peer, shouldn't throw on transport
  // failures, only on invalid input, shouldn't throw if
  // peer isn't connected
  send(peerId: string, changes: PeerMessage): Promise<void>;
}
