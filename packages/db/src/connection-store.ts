/**
 * ConnectionStore - Database layer for OAuth connection metadata.
 *
 * This store handles connection metadata (service, account, status, labels).
 * Actual OAuth tokens are stored in files by CredentialStore in @app/connectors.
 *
 * See specs/connectors-02-connection-manager.md for design details.
 */

import { CRSqliteDB } from "./database";

/**
 * Connection status values.
 * - connected: Credentials exist and valid
 * - expired: Token expired, needs refresh
 * - error: Auth error, needs reconnect
 */
export type ConnectionStatus = "connected" | "expired" | "error";

/**
 * Connection metadata stored in database.
 */
export interface Connection {
  /** Unique ID: "{service}:{accountId}" */
  id: string;
  /** Service identifier, e.g., "gmail", "notion" */
  service: string;
  /** Account identifier, e.g., email or workspace_id */
  account_id: string;
  /** Current connection status */
  status: ConnectionStatus;
  /** User-defined label, e.g., "Work Gmail" */
  label: string | null;
  /** Error message if status is "error" */
  error: string | null;
  /** Creation timestamp (Unix ms) */
  created_at: number;
  /** Last usage timestamp (Unix ms) */
  last_used_at: number | null;
  /** Service-specific metadata (e.g., workspace_name for Notion) */
  metadata: Record<string, unknown> | null;
}

/**
 * Database row format (metadata as JSON string).
 */
interface ConnectionRow {
  id: string;
  service: string;
  account_id: string;
  status: string;
  label: string | null;
  error: string | null;
  created_at: number;
  last_used_at: number | null;
  metadata: string | null;
}

/**
 * Convert database row to Connection object.
 */
function rowToConnection(row: ConnectionRow): Connection {
  return {
    ...row,
    status: row.status as ConnectionStatus,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

/**
 * Store for OAuth connection metadata.
 * Implements the ConnectionDb interface expected by ConnectionManager.
 */
export class ConnectionStore {
  constructor(private db: CRSqliteDB) {}

  /**
   * Get a specific connection by ID.
   */
  async getConnection(id: string): Promise<Connection | null> {
    const results = await this.db.db.execO<ConnectionRow>(
      "SELECT * FROM connections WHERE id = ?",
      [id]
    );
    return results?.[0] ? rowToConnection(results[0]) : null;
  }

  /**
   * List all connections, ordered by creation date (newest first).
   */
  async listConnections(): Promise<Connection[]> {
    const results = await this.db.db.execO<ConnectionRow>(
      "SELECT * FROM connections ORDER BY created_at DESC"
    );
    return (results || []).map(rowToConnection);
  }

  /**
   * List connections for a specific service.
   */
  async listByService(service: string): Promise<Connection[]> {
    const results = await this.db.db.execO<ConnectionRow>(
      "SELECT * FROM connections WHERE service = ? ORDER BY created_at DESC",
      [service]
    );
    return (results || []).map(rowToConnection);
  }

  /**
   * Insert or update a connection.
   */
  async upsertConnection(
    conn: Omit<Connection, "metadata"> & { metadata?: Record<string, unknown> }
  ): Promise<void> {
    const metadataJson = conn.metadata ? JSON.stringify(conn.metadata) : null;
    await this.db.db.exec(
      `
      INSERT INTO connections (id, service, account_id, status, label, error, created_at, last_used_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        label = COALESCE(excluded.label, connections.label),
        error = excluded.error,
        last_used_at = excluded.last_used_at,
        metadata = COALESCE(excluded.metadata, connections.metadata)
    `,
      [
        conn.id,
        conn.service,
        conn.account_id,
        conn.status,
        conn.label,
        conn.error,
        conn.created_at,
        conn.last_used_at,
        metadataJson,
      ]
    );
  }

  /**
   * Update connection status and optionally set error message.
   */
  async updateStatus(
    id: string,
    status: ConnectionStatus,
    error?: string
  ): Promise<void> {
    await this.db.db.exec(
      "UPDATE connections SET status = ?, error = ? WHERE id = ?",
      [status, error ?? null, id]
    );
  }

  /**
   * Update last_used_at timestamp.
   */
  async updateLastUsed(id: string, timestamp?: number): Promise<void> {
    await this.db.db.exec(
      "UPDATE connections SET last_used_at = ? WHERE id = ?",
      [timestamp ?? Date.now(), id]
    );
  }

  /**
   * Update connection label.
   */
  async updateLabel(id: string, label: string): Promise<void> {
    await this.db.db.exec("UPDATE connections SET label = ? WHERE id = ?", [
      label,
      id,
    ]);
  }

  /**
   * Delete a connection.
   */
  async deleteConnection(id: string): Promise<void> {
    await this.db.db.exec("DELETE FROM connections WHERE id = ?", [id]);
  }
}
