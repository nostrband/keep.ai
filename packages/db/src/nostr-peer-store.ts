import { CRSqliteDB } from "./database";

export interface NostrPeer {
  peer_pubkey: string;
  peer_id: string;
  local_pubkey: string;
  local_id: string;
  device_info: string;
  timestamp: string;
  relays: string;
}

export interface NostrPeerCursorSend {
  peer_pubkey: string;
  send_cursor: string;
  send_cursor_id: string;
  send_changes_event_id: string;
  send_changes_timestamp: number;
}

export interface NostrPeerCursorRecv {
  peer_pubkey: string;
  recv_cursor: string;
  recv_cursor_id: string;
  recv_changes_event_id: string;
  recv_changes_timestamp: number;
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

  async addPeer(p: NostrPeer): Promise<void> {
    p.timestamp = p.timestamp || new Date().toISOString();

    await this.db.db.exec(
      `INSERT OR REPLACE INTO nostr_peers (peer_pubkey, peer_id, local_pubkey, local_id, device_info, timestamp, relays)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        p.peer_pubkey,
        p.peer_id,
        p.local_pubkey,
        p.local_id,
        p.device_info,
        p.timestamp,
        p.relays,
      ]
    );
  }

  async deletePeers(peerPubkeys: string[]): Promise<void> {
    if (peerPubkeys.length === 0) return;

    const placeholders = peerPubkeys.map(() => "?").join(",");
    await this.db.db.exec(
      `DELETE FROM nostr_peers WHERE peer_pubkey IN (${placeholders})`,
      peerPubkeys
    );
  }

  async setNostrPeerCursorSend(c: NostrPeerCursorSend): Promise<void> {
    await this.db.db.exec(
      `INSERT INTO nostr_peer_cursors (
        peer_pubkey,
        send_cursor, send_cursor_id, send_changes_event_id, send_changes_timestamp
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(peer_pubkey) DO UPDATE SET
        send_cursor = excluded.send_cursor,
        send_cursor_id = excluded.send_cursor_id,
        send_changes_event_id = excluded.send_changes_event_id,
        send_changes_timestamp = excluded.send_changes_timestamp`,
      [
        c.peer_pubkey,
        c.send_cursor,
        c.send_cursor_id,
        c.send_changes_event_id,
        c.send_changes_timestamp,
      ]
    );
  }

  async setNostrPeerCursorRecv(c: NostrPeerCursorRecv): Promise<void> {
    await this.db.db.exec(
      `INSERT INTO nostr_peer_cursors (
        peer_pubkey,
        recv_cursor, recv_cursor_id, recv_changes_event_id, recv_changes_timestamp
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(peer_pubkey) DO UPDATE SET
        recv_cursor = excluded.recv_cursor,
        recv_cursor_id = excluded.recv_cursor_id,
        recv_changes_event_id = excluded.recv_changes_event_id,
        recv_changes_timestamp = excluded.recv_changes_timestamp`,
      [
        c.peer_pubkey,
        c.recv_cursor,
        c.recv_cursor_id,
        c.recv_changes_event_id,
        c.recv_changes_timestamp,
      ]
    );
  }

  async getNostrPeerCursorSend(
    peerPubkey: string
  ): Promise<NostrPeerCursorSend | null> {
    const results = await this.db.db.execO<NostrPeerCursorSend>(
      "SELECT peer_pubkey, send_cursor, send_cursor_id, send_changes_event_id, send_changes_timestamp FROM nostr_peer_cursors WHERE peer_pubkey = ?",
      [peerPubkey]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return results[0];
  }

  async getNostrPeerCursorRecv(
    peerPubkey: string
  ): Promise<NostrPeerCursorRecv | null> {
    const results = await this.db.db.execO<NostrPeerCursorRecv>(
      "SELECT peer_pubkey, recv_cursor, recv_cursor_id, recv_changes_event_id, recv_changes_timestamp FROM nostr_peer_cursors WHERE peer_pubkey = ?",
      [peerPubkey]
    );

    if (!results || results.length === 0) {
      return null;
    }

    return results[0];
  }

  // async listNostrPeerCursors(): Promise<NostrPeerCursor[]> {
  //   const results = await this.db.db.execO<NostrPeerCursor>(
  //     "SELECT * FROM nostr_peer_cursors ORDER BY peer_pubkey"
  //   );

  //   if (!results) return [];

  //   return results;
  // }

  async deleteNostrPeerCursor(peerPubkey: string): Promise<void> {
    await this.db.db.exec(
      "DELETE FROM nostr_peer_cursors WHERE peer_pubkey = ?",
      [peerPubkey]
    );
  }
}
