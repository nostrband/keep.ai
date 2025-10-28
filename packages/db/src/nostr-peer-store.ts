import { CRSqliteDB } from "./database";

export interface NostrPeer {
  peer_pubkey: string;
  peer_id: string;
  connection_pubkey: string;
  device_info: string;
  timestamp: string;
  relays: string;
}

export interface NostrPeerCursor {
  peer_pubkey: string;
  last_cursor: string;
  last_cursor_event_id: string;
  last_changes_event_id: string;
  peer_cursor: string;
  peer_cursor_event_id: string;
  peer_changes_event_id: string;
}

export class NostrPeerStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  async listPeers(): Promise<NostrPeer[]> {
    const results = await this.db.db.execO<NostrPeer>(
      "SELECT * FROM nostr_peers ORDER BY timestamp DESC"
    );

    if (!results) return [];

    return results;
  }

  async getPeer(peerPubkey: string): Promise<NostrPeer | null> {
    const results = await this.db.db.execO<NostrPeer>(
      "SELECT * FROM nostr_peers WHERE peer_pubkey = ?",
      [peerPubkey]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return results[0];
  }

  async addPeer(
    peerPubkey: string,
    peerId: string,
    connectionPubkey: string,
    deviceInfo: string,
    relays: string = ""
  ): Promise<NostrPeer> {
    const timestamp = new Date().toISOString();

    await this.db.db.exec(
      `INSERT OR REPLACE INTO nostr_peers (peer_pubkey, peer_id, connection_pubkey, device_info, timestamp, relays)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [peerPubkey, peerId, connectionPubkey, deviceInfo, timestamp, relays]
    );

    return {
      peer_pubkey: peerPubkey,
      peer_id: peerId,
      connection_pubkey: connectionPubkey,
      device_info: deviceInfo,
      timestamp,
      relays,
    };
  }

  async deletePeer(peerPubkey: string): Promise<void> {
    await this.db.db.exec("DELETE FROM nostr_peers WHERE peer_pubkey = ?", [
      peerPubkey,
    ]);
  }

  async setNostrPeerCursor(nostrPeerCursor: NostrPeerCursor): Promise<void> {
    await this.db.db.exec(
      `INSERT OR REPLACE INTO nostr_peer_cursors (
        peer_pubkey, 
        last_cursor, last_cursor_event_id, last_changes_event_id, 
        peer_cursor, peer_cursor_event_id, peer_changes_event_id
       )
       VALUES (?, ?, ?, ?)`,
      [
        nostrPeerCursor.peer_pubkey,
        nostrPeerCursor.last_cursor,
        nostrPeerCursor.last_cursor_event_id,
        nostrPeerCursor.last_changes_event_id,
        nostrPeerCursor.peer_cursor,
        nostrPeerCursor.peer_cursor_event_id,
        nostrPeerCursor.peer_changes_event_id,
      ]
    );
  }

  async getNostrPeerCursor(
    peerPubkey: string
  ): Promise<NostrPeerCursor | null> {
    const results = await this.db.db.execO<NostrPeerCursor>(
      "SELECT * FROM nostr_peer_cursors WHERE peer_pubkey = ?",
      [peerPubkey]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return results[0];
  }

  async listNostrPeerCursors(): Promise<NostrPeerCursor[]> {
    const results = await this.db.db.execO<NostrPeerCursor>(
      "SELECT * FROM nostr_peer_cursors ORDER BY peer_pubkey"
    );

    if (!results) return [];

    return results;
  }

  async deleteNostrPeerCursor(peerPubkey: string): Promise<void> {
    await this.db.db.exec(
      "DELETE FROM nostr_peer_cursors WHERE peer_pubkey = ?",
      [peerPubkey]
    );
  }
}
