## Connectors 02: Connection Manager

### Goal

Central class that orchestrates connections - handles OAuth flows, manages credentials, provides clients to tools, and emits events for UI updates.

### ConnectionManager class

```typescript
// Database interface - injected, not imported
// This keeps @app/connectors independent of @app/db
// ConnectionStore in @app/db implements this interface
interface ConnectionDb {
  getConnection(id: string): Promise<Connection | null>;
  listConnections(): Promise<Connection[]>;
  listByService(service: string): Promise<Connection[]>;
  upsertConnection(conn: Connection): Promise<void>;
  updateStatus(id: string, status: string, error?: string): Promise<void>;
  updateLastUsed(id: string): Promise<void>;
  deleteConnection(id: string): Promise<void>;
}

export class ConnectionManager {  // No EventEmitter - state changes go through db, UI watches db
  private services = new Map<string, ServiceDefinition>();
  private secrets = new Map<string, { clientId: string; clientSecret: string }>();

  constructor(
    private store: CredentialStore,
    private db: ConnectionDb              // Injected - no @app/db dependency
  ) {}

  // Register a service definition
  registerService(service: ServiceDefinition): void;

  // Set OAuth secrets for a service (from env vars)
  setSecrets(service: string, clientId: string, clientSecret: string): void;

  // Get all registered services
  getServices(): ServiceDefinition[];

  // --- OAuth Flow ---

  // Start OAuth flow - returns URL to redirect user
  startOAuthFlow(service: string, redirectUri: string): {
    authUrl: string;
    state: string;  // Random state for CSRF protection
  };

  // Complete OAuth flow - called from callback endpoint
  async completeOAuthFlow(
    service: string,
    code: string,
    state: string,
    redirectUri: string
  ): Promise<OAuthCallbackResult>;

  // --- Connection Management ---

  // Get all connections
  async listConnections(): Promise<Connection[]>;

  // Get connections for a service
  async listConnectionsByService(service: string): Promise<Connection[]>;

  // Get specific connection
  async getConnection(id: ConnectionId): Promise<Connection | null>;

  // Delete/disconnect
  async disconnect(id: ConnectionId): Promise<void>;

  // Update connection label
  async updateLabel(id: ConnectionId, label: string): Promise<void>;

  // --- Credential Access (for tools) ---

  // Get valid credentials, auto-refreshing if needed
  async getCredentials(id: ConnectionId): Promise<OAuthCredentials>;

  // Mark connection as errored (called by tools on auth failure)
  async markError(id: ConnectionId, error: string): Promise<void>;

  // --- Events ---
  // Emits: 'connection:added', 'connection:removed', 'connection:error', 'connection:refreshed'
}
```

### State management

OAuth flow state stored in memory (Map<state, { service, timestamp }>):
- Generate random state on `startOAuthFlow`
- Verify state on `completeOAuthFlow`
- Prevents CSRF attacks

```typescript
private pendingStates = new Map<string, { service: string; timestamp: number }>();
private readonly STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

startOAuthFlow(service: string, redirectUri: string) {
  // Lazy cleanup: remove expired states on each new flow start
  const now = Date.now();
  for (const [state, data] of this.pendingStates) {
    if (now - data.timestamp > this.STATE_TTL_MS) {
      this.pendingStates.delete(state);
    }
  }

  const state = crypto.randomUUID();
  this.pendingStates.set(state, { service, timestamp: now });
  // ... generate auth URL
}

completeOAuthFlow(service: string, code: string, state: string, redirectUri: string) {
  const pending = this.pendingStates.get(state);
  if (!pending) {
    return { success: false, error: 'Invalid or expired state' };
  }
  if (Date.now() - pending.timestamp > this.STATE_TTL_MS) {
    this.pendingStates.delete(state);
    return { success: false, error: 'OAuth flow expired, please try again' };
  }
  if (pending.service !== service) {
    return { success: false, error: 'State mismatch' };
  }

  this.pendingStates.delete(state); // Consume the state
  // ... exchange code for tokens
}
```

**Cleanup strategy:** Lazy cleanup on `startOAuthFlow` - no background timer needed. OAuth flows are infrequent enough that stale states don't accumulate significantly.

### Token refresh strategy

On-demand refresh in `getCredentials()`:
```typescript
async getCredentials(id: ConnectionId): Promise<OAuthCredentials> {
  const creds = await this.store.load(id);
  if (!creds) throw new AuthError(`No credentials for ${id.service}:${id.accountId}`);

  // Check if expired (with 5 min buffer)
  if (creds.expiresAt && creds.expiresAt < Date.now() + 5 * 60 * 1000) {
    if (!creds.refreshToken) {
      await this.markError(id, 'Token expired, no refresh token');
      throw new AuthError('Token expired');
    }

    const handler = this.getOAuthHandler(id.service);
    const newCreds = await handler.refreshToken(creds.refreshToken);

    // Preserve refresh token if not returned
    newCreds.refreshToken = newCreds.refreshToken || creds.refreshToken;

    await this.store.save(id, newCreds);
    this.emit('connection:refreshed', id);
    return newCreds;
  }

  return creds;
}
```

### Connection status derivation

Status is derived, not stored:
```typescript
function deriveStatus(creds: OAuthCredentials | null, error?: string): ConnectionStatus {
  if (error) return 'error';
  if (!creds) return 'disconnected';
  if (creds.expiresAt && creds.expiresAt < Date.now()) return 'expired';
  return 'connected';
}
```

### Integration with server

Server creates single ConnectionManager instance using ConnectionStore:
```typescript
// In apps/server/src/server.ts
import { ConnectionManager, CredentialStore } from '@app/connectors';
import { getGoogleCredentials, getNotionCredentials } from '@app/connectors/credentials';

// ConnectionStore from @app/db implements the ConnectionDb interface
const connectionManager = new ConnectionManager(
  new CredentialStore(userPath),
  api.connectionStore  // KeepDbApi.connectionStore implements ConnectionDb
);

// Register services
connectionManager.registerService(gmailService);
connectionManager.registerService(gdriveService);
connectionManager.registerService(notionService);

// Set secrets (from build-time bundled constants)
const googleCreds = getGoogleCredentials();
connectionManager.setSecrets('gmail', googleCreds.clientId, googleCreds.clientSecret);
connectionManager.setSecrets('gdrive', googleCreds.clientId, googleCreds.clientSecret);

const notionCreds = getNotionCredentials();
connectionManager.setSecrets('notion', notionCreds.clientId, notionCreds.clientSecret);
```

### Integration with tools

Tools receive ConnectionManager, not raw credentials:
```typescript
// Before (gmail.ts):
export function makeGmailTool(getContext, oAuth2Client) { ... }

// After:
export function makeGmailTool(getContext, connectionManager: ConnectionManager) {
  return async (params) => {
    // Specified account
    const accountId = params.account;
    const creds = await connectionManager.getCredentials({ service: 'gmail', accountId });

    // Create OAuth2Client with credentials
    const client = new google.auth.OAuth2(...);
    client.setCredentials(creds);

    // Make API call
    // ...
  };
}
```

### No default account

Tools MUST specify `accountId` explicitly. No fallback to "first connected" or "default" account.

Rationale:
- Prevents AI agent from accidentally mixing accounts
- Makes scripts explicit and predictable
- Breaking change for existing Gmail scripts, but safer long-term

If tool call omits `accountId`, throw error:
```typescript
throw new LogicError(
  `${service} accountId required. Available accounts: ${accounts.map(a => a.id.accountId).join(', ')}`
);
```

This helps the agent self-correct by listing available accounts in the error.

### Connection state in database

Instead of EventEmitter events, store connection metadata in CRSQLite. Benefits:
- UI already watches db for changes (existing pattern)
- Serverless/mobile clients sync via db, can't access server events
- One way of doing things - consistent architecture
- Low frequency (few events per day) - negligible db overhead

**Separation of concerns:**
- **Files**: OAuth tokens (sensitive) - `{userPath}/connectors/{service}/{accountId}.json`
- **Database**: Connection metadata (non-sensitive) - syncs to all clients

### Database schema

```sql
-- New table in packages/db migrations
CREATE TABLE connections (
  id TEXT PRIMARY KEY,              -- "{service}:{accountId}"
  service TEXT NOT NULL,            -- "gmail", "notion", etc.
  account_id TEXT NOT NULL,         -- email or workspace_id
  status TEXT NOT NULL,             -- "connected", "error", "expired"
  label TEXT,                       -- User-defined label
  error TEXT,                       -- Error message if status="error"
  created_at INTEGER NOT NULL,      -- Unix timestamp ms
  last_used_at INTEGER,             -- Updated on each API call
  metadata TEXT,                    -- JSON: workspace_name, profile info, etc.
  UNIQUE(service, account_id)
);

CREATE INDEX idx_connections_service ON connections(service);
```

### ConnectionStore in @app/db

Following existing store pattern (NoteStore, TaskStore, etc.):

```typescript
// packages/db/src/connection-store.ts

import { CRSqliteDB } from "./database";

export interface Connection {
  id: string;                    // "{service}:{accountId}"
  service: string;
  account_id: string;
  status: "connected" | "error" | "expired";
  label: string | null;
  error: string | null;
  created_at: number;
  last_used_at: number | null;
  metadata: Record<string, unknown> | null;
}

interface ConnectionRow {
  id: string;
  service: string;
  account_id: string;
  status: string;
  label: string | null;
  error: string | null;
  created_at: number;
  last_used_at: number | null;
  metadata: string | null;       // JSON string
}

function rowToConnection(row: ConnectionRow): Connection {
  return {
    ...row,
    status: row.status as Connection["status"],
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

export class ConnectionStore {
  constructor(private db: CRSqliteDB) {}

  async getConnection(id: string): Promise<Connection | null> {
    const results = await this.db.db.execO<ConnectionRow>(
      "SELECT * FROM connections WHERE id = ?",
      [id]
    );
    return results?.[0] ? rowToConnection(results[0]) : null;
  }

  async listConnections(): Promise<Connection[]> {
    const results = await this.db.db.execO<ConnectionRow>(
      "SELECT * FROM connections ORDER BY created_at DESC"
    );
    return (results || []).map(rowToConnection);
  }

  async listByService(service: string): Promise<Connection[]> {
    const results = await this.db.db.execO<ConnectionRow>(
      "SELECT * FROM connections WHERE service = ? ORDER BY created_at DESC",
      [service]
    );
    return (results || []).map(rowToConnection);
  }

  async upsertConnection(conn: Omit<Connection, "metadata"> & { metadata?: Record<string, unknown> }): Promise<void> {
    const metadataJson = conn.metadata ? JSON.stringify(conn.metadata) : null;
    await this.db.db.exec(`
      INSERT INTO connections (id, service, account_id, status, label, error, created_at, last_used_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        label = excluded.label,
        error = excluded.error,
        last_used_at = excluded.last_used_at,
        metadata = excluded.metadata
    `, [conn.id, conn.service, conn.account_id, conn.status, conn.label, conn.error, conn.created_at, conn.last_used_at, metadataJson]);
  }

  async updateStatus(id: string, status: Connection["status"], error?: string): Promise<void> {
    await this.db.db.exec(
      "UPDATE connections SET status = ?, error = ? WHERE id = ?",
      [status, error ?? null, id]
    );
  }

  async updateLastUsed(id: string): Promise<void> {
    await this.db.db.exec(
      "UPDATE connections SET last_used_at = ? WHERE id = ?",
      [Date.now(), id]
    );
  }

  async updateLabel(id: string, label: string): Promise<void> {
    await this.db.db.exec(
      "UPDATE connections SET label = ? WHERE id = ?",
      [label, id]
    );
  }

  async deleteConnection(id: string): Promise<void> {
    await this.db.db.exec("DELETE FROM connections WHERE id = ?", [id]);
  }
}
```

### KeepDbApi update

```typescript
// packages/db/src/api.ts

import { ConnectionStore } from "./connection-store";

export class KeepDbApi {
  // ... existing stores ...
  public readonly connectionStore: ConnectionStore;

  constructor(db: KeepDb) {
    // ... existing ...
    this.connectionStore = new ConnectionStore(db);
  }
}
```

### Connection lifecycle

**On successful OAuth:**
```typescript
// 1. Save tokens to file
await this.store.save(connectionId, credentials);

// 2. Insert/update db row
await db.exec(`
  INSERT INTO connections (id, service, account_id, status, created_at, metadata)
  VALUES (?, ?, ?, 'connected', ?, ?)
  ON CONFLICT(id) DO UPDATE SET status='connected', error=NULL, metadata=?
`, [id, service, accountId, Date.now(), metadataJson, metadataJson]);
```

**On auth error:**
```typescript
// Update db status - UI sees this via sync
await db.exec(`
  UPDATE connections SET status='error', error=? WHERE id=?
`, [errorMessage, id]);
```

**On disconnect:**
```typescript
// 1. Delete tokens file
await this.store.delete(connectionId);

// 2. Delete db row
await db.exec(`DELETE FROM connections WHERE id=?`, [id]);
```

**On token refresh:**
```typescript
// Just update file, no db change needed (status stays "connected")
await this.store.save(connectionId, newCredentials);
```

**On API call:**
```typescript
// Update last_used_at
await db.exec(`
  UPDATE connections SET last_used_at=? WHERE id=?
`, [Date.now(), id]);
```

### UI watches db

```typescript
// apps/web - existing pattern
const connections = useLiveQuery(() => db.connections.toArray());

// Reacts to any connection changes automatically
```

### Startup reconciliation

On server start, reconcile db with files:
```typescript
async reconcileConnections() {
  // Get all credential files
  const fileConnections = await this.store.listAll();

  // Get all db rows
  const dbConnections = await db.exec('SELECT id FROM connections');

  // File exists but no db row -> add to db (migration from old format)
  // Db row exists but no file -> delete from db (stale)
  // Both exist -> validate and update status
}
```

### TBD

- Background token refresh (vs on-demand only)
- Connection health checks
- Sync conflict resolution (unlikely but possible)
