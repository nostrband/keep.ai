/**
 * Adapter to connect @app/db ConnectionStore to @app/connectors ConnectionDb interface.
 *
 * The db package uses snake_case for column names, while the connectors package
 * uses camelCase for its interfaces. This adapter handles the conversion.
 */

import type { Connection, ConnectionDb } from "./types";

/**
 * Database Connection type (snake_case, as stored in SQLite).
 */
export interface DbConnection {
  id: string;
  service: string;
  account_id: string;
  status: "connected" | "expired" | "error";
  label: string | null;
  error: string | null;
  created_at: number;
  last_used_at: number | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Database store interface (what @app/db provides).
 */
export interface DbConnectionStore {
  getConnection(id: string): Promise<DbConnection | null>;
  listConnections(): Promise<DbConnection[]>;
  listByService(service: string): Promise<DbConnection[]>;
  upsertConnection(
    conn: Omit<DbConnection, "metadata"> & { metadata?: Record<string, unknown> }
  ): Promise<void>;
  updateStatus(
    id: string,
    status: "connected" | "expired" | "error",
    error?: string
  ): Promise<void>;
  updateLastUsed(id: string, timestamp?: number): Promise<void>;
  deleteConnection(id: string): Promise<void>;
}

/**
 * Convert from DB snake_case to API camelCase.
 */
function dbToApi(db: DbConnection): Connection {
  return {
    id: db.id,
    service: db.service,
    accountId: db.account_id,
    status: db.status,
    label: db.label ?? undefined,
    error: db.error ?? undefined,
    createdAt: db.created_at,
    lastUsedAt: db.last_used_at ?? undefined,
    metadata: db.metadata ?? undefined,
  };
}

/**
 * Convert from API camelCase to DB snake_case.
 */
function apiToDb(
  api: Connection
): Omit<DbConnection, "metadata"> & { metadata?: Record<string, unknown> } {
  return {
    id: api.id,
    service: api.service,
    account_id: api.accountId,
    status: api.status as "connected" | "expired" | "error",
    label: api.label ?? null,
    error: api.error ?? null,
    created_at: api.createdAt,
    last_used_at: api.lastUsedAt ?? null,
    metadata: api.metadata,
  };
}

/**
 * Adapter that wraps @app/db ConnectionStore to implement ConnectionDb interface.
 */
export class ConnectionDbAdapter implements ConnectionDb {
  constructor(private store: DbConnectionStore) {}

  async getConnection(id: string): Promise<Connection | null> {
    const dbConn = await this.store.getConnection(id);
    return dbConn ? dbToApi(dbConn) : null;
  }

  async listConnections(service?: string): Promise<Connection[]> {
    const dbConns = service
      ? await this.store.listByService(service)
      : await this.store.listConnections();
    return dbConns.map(dbToApi);
  }

  async upsertConnection(connection: Connection): Promise<void> {
    await this.store.upsertConnection(apiToDb(connection));
  }

  async deleteConnection(id: string): Promise<void> {
    await this.store.deleteConnection(id);
  }

  async updateLastUsed(id: string, timestamp: number): Promise<void> {
    await this.store.updateLastUsed(id, timestamp);
  }
}

/**
 * Create a ConnectionDb adapter from a @app/db ConnectionStore.
 */
export function createConnectionDbAdapter(
  store: DbConnectionStore
): ConnectionDb {
  return new ConnectionDbAdapter(store);
}
