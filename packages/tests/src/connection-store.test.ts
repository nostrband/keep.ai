import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DBInterface, KeepDb, ConnectionStore, Connection, ConnectionStatus } from "@app/db";
import { createDBNode } from "@app/node";

/**
 * Input type for upsertConnection - matches the method signature.
 * Different from Connection which has metadata: Record | null.
 */
type ConnectionInput = Omit<Connection, "metadata"> & { metadata?: Record<string, unknown> };

/**
 * Helper to create connections table without full migration system.
 * This allows testing the store in isolation without CR-SQLite dependencies.
 * Schema matches v33.ts migration.
 */
async function createConnectionsTable(db: DBInterface): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'connected',
      label TEXT,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      metadata TEXT
    )
  `);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_connections_service ON connections(service)`
  );
}

describe("ConnectionStore", () => {
  let db: DBInterface;
  let keepDb: KeepDb;
  let connectionStore: ConnectionStore;

  beforeEach(async () => {
    db = await createDBNode(":memory:");
    keepDb = new KeepDb(db);
    await createConnectionsTable(db);
    connectionStore = new ConnectionStore(keepDb);
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  describe("upsertConnection and getConnection", () => {
    it("should insert and retrieve a connection", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "connected",
        label: "Work Gmail",
        error: null,
        created_at: Date.now(),
        last_used_at: null,
        metadata: { workspace: "main" },
      };

      await connectionStore.upsertConnection(conn);
      const retrieved = await connectionStore.getConnection("gmail:test@example.com");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(conn.id);
      expect(retrieved?.service).toBe(conn.service);
      expect(retrieved?.account_id).toBe(conn.account_id);
      expect(retrieved?.status).toBe(conn.status);
      expect(retrieved?.label).toBe(conn.label);
      expect(retrieved?.error).toBeNull();
      expect(retrieved?.metadata).toEqual({ workspace: "main" });
    });

    it("should return null for non-existent connection", async () => {
      const retrieved = await connectionStore.getConnection("non-existent");
      expect(retrieved).toBeNull();
    });

    it("should update existing connection on conflict", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "connected",
        label: "Original Label",
        error: null,
        created_at: Date.now(),
        last_used_at: null,
        metadata: { version: 1 },
      };

      await connectionStore.upsertConnection(conn);

      // Update with new status and null label
      const updatedConn: ConnectionInput = {
        ...conn,
        status: "expired" as ConnectionStatus,
        label: null, // Should preserve original label
        metadata: { version: 2 },
      };
      await connectionStore.upsertConnection(updatedConn);

      const retrieved = await connectionStore.getConnection("gmail:test@example.com");
      expect(retrieved?.status).toBe("expired");
      expect(retrieved?.label).toBe("Original Label"); // Preserved by COALESCE
      expect(retrieved?.metadata).toEqual({ version: 2 });
    });

    it("should handle connection without metadata", async () => {
      const conn: Omit<Connection, "metadata"> = {
        id: "notion:workspace-1",
        service: "notion",
        account_id: "workspace-1",
        status: "connected",
        label: null,
        error: null,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);
      const retrieved = await connectionStore.getConnection("notion:workspace-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.metadata).toBeNull();
    });

    it("should handle all connection statuses", async () => {
      const statuses: ConnectionStatus[] = ["connected", "expired", "error"];

      for (const status of statuses) {
        const conn: ConnectionInput = {
          id: `test:${status}`,
          service: "test",
          account_id: status,
          status,
          label: null,
          error: status === "error" ? "Auth failed" : null,
          created_at: Date.now(),
          last_used_at: null,
        };

        await connectionStore.upsertConnection(conn);
        const retrieved = await connectionStore.getConnection(`test:${status}`);
        expect(retrieved?.status).toBe(status);
      }
    });
  });

  describe("listConnections", () => {
    let connections: ConnectionInput[];

    beforeEach(async () => {
      const now = Date.now();
      connections = [
        {
          id: "gmail:old@example.com",
          service: "gmail",
          account_id: "old@example.com",
          status: "connected",
          label: "Old Gmail",
          error: null,
          created_at: now - 3000,
          last_used_at: null,
        },
        {
          id: "notion:workspace-1",
          service: "notion",
          account_id: "workspace-1",
          status: "expired",
          label: "Work Notion",
          error: null,
          created_at: now - 2000,
          last_used_at: now - 1000,
          metadata: { name: "Work Space" },
        },
        {
          id: "gmail:new@example.com",
          service: "gmail",
          account_id: "new@example.com",
          status: "connected",
          label: "New Gmail",
          error: null,
          created_at: now - 1000,
          last_used_at: null,
        },
        {
          id: "slack:team-1",
          service: "slack",
          account_id: "team-1",
          status: "error",
          label: null,
          error: "Token revoked",
          created_at: now,
          last_used_at: null,
          metadata: { team_name: "Engineering" },
        },
      ];

      for (const conn of connections) {
        await connectionStore.upsertConnection(conn);
      }
    });

    it("should list all connections ordered by created_at DESC", async () => {
      const result = await connectionStore.listConnections();

      expect(result).toHaveLength(4);
      // Newest first
      expect(result[0].id).toBe("slack:team-1");
      expect(result[1].id).toBe("gmail:new@example.com");
      expect(result[2].id).toBe("notion:workspace-1");
      expect(result[3].id).toBe("gmail:old@example.com");
    });

    it("should return empty array when no connections exist", async () => {
      // Create new database without connections
      await db.close();
      db = await createDBNode(":memory:");
      keepDb = new KeepDb(db);
      await createConnectionsTable(db);
      connectionStore = new ConnectionStore(keepDb);

      const result = await connectionStore.listConnections();
      expect(result).toHaveLength(0);
    });
  });

  describe("listByService", () => {
    beforeEach(async () => {
      const now = Date.now();
      const connections: ConnectionInput[] = [
        {
          id: "gmail:work@example.com",
          service: "gmail",
          account_id: "work@example.com",
          status: "connected",
          label: "Work",
          error: null,
          created_at: now - 2000,
          last_used_at: null,
        },
        {
          id: "gmail:personal@example.com",
          service: "gmail",
          account_id: "personal@example.com",
          status: "connected",
          label: "Personal",
          error: null,
          created_at: now - 1000,
          last_used_at: null,
        },
        {
          id: "notion:workspace-1",
          service: "notion",
          account_id: "workspace-1",
          status: "connected",
          label: null,
          error: null,
          created_at: now,
          last_used_at: null,
        },
      ];

      for (const conn of connections) {
        await connectionStore.upsertConnection(conn);
      }
    });

    it("should filter connections by service", async () => {
      const gmailConnections = await connectionStore.listByService("gmail");
      expect(gmailConnections).toHaveLength(2);
      expect(gmailConnections.every((c) => c.service === "gmail")).toBe(true);

      const notionConnections = await connectionStore.listByService("notion");
      expect(notionConnections).toHaveLength(1);
      expect(notionConnections[0].service).toBe("notion");
    });

    it("should return connections ordered by created_at DESC", async () => {
      const gmailConnections = await connectionStore.listByService("gmail");
      expect(gmailConnections[0].id).toBe("gmail:personal@example.com"); // Newer
      expect(gmailConnections[1].id).toBe("gmail:work@example.com"); // Older
    });

    it("should return empty array for non-existent service", async () => {
      const result = await connectionStore.listByService("slack");
      expect(result).toHaveLength(0);
    });
  });

  describe("updateStatus", () => {
    it("should update connection status", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "connected",
        label: null,
        error: null,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);
      await connectionStore.updateStatus("gmail:test@example.com", "expired");

      const retrieved = await connectionStore.getConnection("gmail:test@example.com");
      expect(retrieved?.status).toBe("expired");
      expect(retrieved?.error).toBeNull();
    });

    it("should update status with error message", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "connected",
        label: null,
        error: null,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);
      await connectionStore.updateStatus(
        "gmail:test@example.com",
        "error",
        "Token revoked by user"
      );

      const retrieved = await connectionStore.getConnection("gmail:test@example.com");
      expect(retrieved?.status).toBe("error");
      expect(retrieved?.error).toBe("Token revoked by user");
    });

    it("should clear error when status changes to connected", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "error",
        label: null,
        error: "Previous error",
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);
      await connectionStore.updateStatus("gmail:test@example.com", "connected");

      const retrieved = await connectionStore.getConnection("gmail:test@example.com");
      expect(retrieved?.status).toBe("connected");
      expect(retrieved?.error).toBeNull();
    });

    it("should handle update for non-existent connection", async () => {
      // Should not throw, just no-op
      await connectionStore.updateStatus("non-existent", "expired");
      const retrieved = await connectionStore.getConnection("non-existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("updateLastUsed", () => {
    it("should update last_used_at timestamp", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "connected",
        label: null,
        error: null,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);

      const timestamp = Date.now();
      await connectionStore.updateLastUsed("gmail:test@example.com", timestamp);

      const retrieved = await connectionStore.getConnection("gmail:test@example.com");
      expect(retrieved?.last_used_at).toBe(timestamp);
    });

    it("should use current time when timestamp not provided", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "connected",
        label: null,
        error: null,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);

      const before = Date.now();
      await connectionStore.updateLastUsed("gmail:test@example.com");
      const after = Date.now();

      const retrieved = await connectionStore.getConnection("gmail:test@example.com");
      expect(retrieved?.last_used_at).toBeGreaterThanOrEqual(before);
      expect(retrieved?.last_used_at).toBeLessThanOrEqual(after);
    });
  });

  describe("updateLabel", () => {
    it("should update connection label", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "connected",
        label: null,
        error: null,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);
      await connectionStore.updateLabel("gmail:test@example.com", "Work Account");

      const retrieved = await connectionStore.getConnection("gmail:test@example.com");
      expect(retrieved?.label).toBe("Work Account");
    });

    it("should overwrite existing label", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "connected",
        label: "Old Label",
        error: null,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);
      await connectionStore.updateLabel("gmail:test@example.com", "New Label");

      const retrieved = await connectionStore.getConnection("gmail:test@example.com");
      expect(retrieved?.label).toBe("New Label");
    });
  });

  describe("deleteConnection", () => {
    it("should delete an existing connection", async () => {
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "connected",
        label: null,
        error: null,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);
      expect(await connectionStore.getConnection("gmail:test@example.com")).not.toBeNull();

      await connectionStore.deleteConnection("gmail:test@example.com");
      expect(await connectionStore.getConnection("gmail:test@example.com")).toBeNull();
    });

    it("should not throw when deleting non-existent connection", async () => {
      // Should not throw
      await connectionStore.deleteConnection("non-existent");
    });
  });

  describe("metadata handling", () => {
    it("should store and retrieve complex metadata", async () => {
      const complexMetadata = {
        workspace_name: "Engineering Team",
        permissions: ["read", "write", "admin"],
        settings: {
          notifications: true,
          theme: "dark",
        },
        count: 42,
      };

      const conn: ConnectionInput = {
        id: "notion:workspace-1",
        service: "notion",
        account_id: "workspace-1",
        status: "connected",
        label: null,
        error: null,
        created_at: Date.now(),
        last_used_at: null,
        metadata: complexMetadata,
      };

      await connectionStore.upsertConnection(conn);
      const retrieved = await connectionStore.getConnection("notion:workspace-1");

      expect(retrieved?.metadata).toEqual(complexMetadata);
    });

    it("should preserve existing metadata when upserting with null metadata", async () => {
      const originalMetadata = { key: "value" };
      const conn: ConnectionInput = {
        id: "notion:workspace-1",
        service: "notion",
        account_id: "workspace-1",
        status: "connected",
        label: null,
        error: null,
        created_at: Date.now(),
        last_used_at: null,
        metadata: originalMetadata,
      };

      await connectionStore.upsertConnection(conn);

      // Upsert without metadata
      await connectionStore.upsertConnection({
        id: "notion:workspace-1",
        service: "notion",
        account_id: "workspace-1",
        status: "expired",
        label: null,
        error: null,
        created_at: conn.created_at,
        last_used_at: null,
      });

      const retrieved = await connectionStore.getConnection("notion:workspace-1");
      expect(retrieved?.metadata).toEqual(originalMetadata); // Preserved by COALESCE
    });
  });

  describe("edge cases", () => {
    it("should handle special characters in IDs", async () => {
      const conn: ConnectionInput = {
        id: "gmail:user+tag@example.com",
        service: "gmail",
        account_id: "user+tag@example.com",
        status: "connected",
        label: "Email with plus",
        error: null,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);
      const retrieved = await connectionStore.getConnection("gmail:user+tag@example.com");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.account_id).toBe("user+tag@example.com");
    });

    it("should handle unicode in label and metadata", async () => {
      const conn: ConnectionInput = {
        id: "slack:team-1",
        service: "slack",
        account_id: "team-1",
        status: "connected",
        label: "工程团队 🚀",
        error: null,
        created_at: Date.now(),
        last_used_at: null,
        metadata: { team_name: "Équipe d'ingénierie" },
      };

      await connectionStore.upsertConnection(conn);
      const retrieved = await connectionStore.getConnection("slack:team-1");

      expect(retrieved?.label).toBe("工程团队 🚀");
      expect(retrieved?.metadata).toEqual({ team_name: "Équipe d'ingénierie" });
    });

    it("should handle very long error messages", async () => {
      const longError = "E".repeat(10000);
      const conn: ConnectionInput = {
        id: "gmail:test@example.com",
        service: "gmail",
        account_id: "test@example.com",
        status: "error",
        label: null,
        error: longError,
        created_at: Date.now(),
        last_used_at: null,
      };

      await connectionStore.upsertConnection(conn);
      const retrieved = await connectionStore.getConnection("gmail:test@example.com");

      expect(retrieved?.error).toBe(longError);
    });
  });
});
