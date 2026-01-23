# Keep.AI v1.0.0 Implementation Plan

> **Note (2026-01-23):** Sections 1.1 (Build-Time Secrets), 1.2 (Core Connectors Package), and 1.3 (Connection Manager + Database) are now fully implemented.

## Priority 1: Connectors Framework (Current Focus - BLOCKING)

The connectors framework enables multi-account OAuth connections for Gmail and other services. This is the current development focus and blocks all new service integrations.

**Current State (Verified via Code Analysis):**
- `packages/connectors` does NOT exist - must be created from scratch
- Gmail OAuth currently implemented inline in `apps/server/src/server.ts`:
  - Lines 88-92: Hardcoded client ID `642393276548-lfrhhkuf7nfuo6o3542tmibj8306a17m.apps.googleusercontent.com`
  - Lines 116-190: `createGmailOAuth2Client()` function with token refresh listener
  - Lines 1105-1492: Four Gmail endpoints (`/api/gmail/status`, `/connect`, `/callback`, `/check`)
- Single account only, stored in `{userPath}/gmail.json`
- Token refresh via `oAuth2Client.on("tokens")` event listener pattern (to be replaced)
- Current tool registration in `packages/agent/src/sandbox/api.ts:370-375` is conditional on OAuth client

### 1.1 Build-Time Secrets (spec: connectors-00-build-secrets.md)

**Action Items:**
- [x] Create `secrets.build.json` template at project root with structure:
  ```json
  {
    "GOOGLE_CLIENT_ID": "...",
    "GOOGLE_CLIENT_SECRET": "...",
    "NOTION_CLIENT_ID": "...",
    "NOTION_CLIENT_SECRET": "..."
  }
  ```
- [x] Update `apps/server/tsup.config.ts` - current pattern (lines 4-19):
  - Add file loading: `const secrets = fs.existsSync('secrets.build.json') ? JSON.parse(fs.readFileSync('secrets.build.json', 'utf-8')) : {}`
  - Add validation for each secret with env var fallback
  - Add to `define` object: `'process.env.GOOGLE_CLIENT_ID': JSON.stringify(secrets.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)`
- [x] Add `secrets.build.example.json` (committed) with empty values and comments
- [x] Add `secrets.build.json` to `.gitignore` (verify not already present)
- [x] Create `packages/connectors/src/credentials.ts`:
  ```typescript
  export interface OAuthAppCredentials { clientId: string; clientSecret: string; }
  export function getGoogleCredentials(): OAuthAppCredentials { /* from process.env */ }
  export function getNotionCredentials(): OAuthAppCredentials { /* from process.env */ }
  ```
- [x] Document CI/CD setup: GitHub Actions should set env vars that override missing secrets file

**Constraints:**
- Desktop OAuth client secrets are public by design (security relies on redirect URI validation)
- Must maintain backwards compatibility with existing env var approach for CI
- Current hardcoded CLIENT_ID in server.ts must be moved to secrets

### 1.2 Core Connectors Package (spec: connectors-01-core-package.md) - BLOCKS 1.3-1.7

**Action Items:**
- [x] Create `packages/connectors/` directory structure:
  ```
  packages/connectors/
  ├── package.json          # name: "@app/connectors", minimal deps
  ├── tsconfig.json         # extends root tsconfig
  └── src/
      ├── index.ts          # public exports
      ├── types.ts          # ConnectionId, OAuthConfig, OAuthCredentials, Connection, ServiceDefinition
      ├── oauth.ts          # OAuthHandler class
      ├── store.ts          # CredentialStore class (file-based)
      ├── credentials.ts    # getGoogleCredentials(), getNotionCredentials()
      └── services/         # service definitions (added in later specs)
  ```
- [x] Implement `types.ts` interfaces (see spec for full definitions):
  - `ConnectionId` = `${service}:${accountId}` format
  - `OAuthConfig` = URLs, scopes, extra params
  - `OAuthCredentials` = access_token, refresh_token, expiry_date, metadata
  - `Connection` = id, service, accountId, status, label, error, timestamps
  - `ServiceDefinition` = name, oauthConfig, fetchProfile, extractAccountId
- [x] Implement `oauth.ts` OAuthHandler class:
  - `getAuthUrl(config, state)` - generate authorization URL
  - `exchangeCode(config, code, redirectUri)` - exchange code for tokens
  - `refreshToken(config, refreshToken)` - refresh expired access token
  - Support both standard OAuth2 and Basic auth (for Notion)
- [x] Implement `store.ts` CredentialStore class:
  - Path pattern: `{userPath}/connectors/{service}/{accountId}.json`
  - `save(service, accountId, credentials)` - write with mode 0o600
  - `load(service, accountId)` - read credentials
  - `delete(service, accountId)` - remove credentials file
  - `listByService(service)` - list all accountIds for service
  - `listAll()` - list all connections
- [x] Add `credentials.ts` (from 1.1)
- [x] Export all public interfaces from `index.ts`
- [x] Add package.json:
  ```json
  {
    "name": "@app/connectors",
    "main": "src/index.ts",
    "dependencies": {}  // minimal - no @app/db
  }
  ```
- [x] Add to root package.json workspaces if not auto-detected

**Testing Requirements:**
- [x] Unit tests for OAuthHandler (95%+ coverage target for security-critical code)
- [x] Unit tests for CredentialStore (98%+ coverage target - handles sensitive data)
- [x] Integration tests for token refresh flow
- [x] Mock tests for OAuth URL generation and code exchange

**Constraints:**
- Credentials stored in files (sensitive), metadata in database (syncs to clients)
- File permissions: mode 0o600 for credential JSON files (use `packages/node` pattern)
- Keep package independent of @app/db (database interface injected, not imported)
- No service SDKs (googleapis, @notionhq/client) - those go in @app/agent

**Gotchas:**
- Notion tokens don't expire (no refresh needed) - `refreshToken()` should no-op
- Notion uses Basic auth for token exchange: `Authorization: Basic base64(clientId:clientSecret)`
- Google requires `access_type: offline` and `prompt: consent` for refresh tokens
- Google profile: `https://www.googleapis.com/oauth2/v1/userinfo`, accountId = email
- Notion profile: in token response metadata, accountId = workspace_id

### 1.3 Connection Manager + Database (spec: connectors-02-connection-manager.md) - BLOCKS 1.4-1.7

**Action Items:**
- [x] Create `ConnectionManager` class in `packages/connectors/src/connection-manager.ts`:
  ```typescript
  interface ConnectionDb {  // Injected, not imported from @app/db
    getConnection(id: string): Promise<Connection | null>;
    listConnections(service?: string): Promise<Connection[]>;
    upsertConnection(connection: Connection): Promise<void>;
    deleteConnection(id: string): Promise<void>;
  }

  class ConnectionManager {
    constructor(
      private store: CredentialStore,
      private db: ConnectionDb,
      private userPath: string
    ) {}

    registerService(service: ServiceDefinition): void;
    startOAuthFlow(service: string): { authUrl: string; state: string };
    completeOAuthFlow(service: string, code: string, state: string): Promise<Connection>;
    getCredentials(service: string, accountId: string): Promise<OAuthCredentials>;
    disconnect(service: string, accountId: string): Promise<void>;
    listConnections(service?: string): Promise<Connection[]>;
    markError(service: string, accountId: string, error: string): Promise<void>;
  }
  ```
- [x] Implement CSRF protection:
  - Generate random state parameter on `startOAuthFlow()`
  - Store in Map with timestamp: `pendingStates: Map<string, { service: string; timestamp: number }>`
  - Validate and consume in `completeOAuthFlow()`
  - TTL: 10 minutes, lazy cleanup on new flow starts
- [x] Implement token refresh in `getCredentials()`:
  - Check `expiry_date - 5 minutes < now`
  - If expired/expiring, call `oauthHandler.refreshToken()`
  - Save new credentials via `store.save()`
  - For Notion: skip refresh (tokens don't expire)
- [x] Create database migration **v33** in `packages/db/src/migrations/v33.ts`:
  ```typescript
  export async function migrateV33(tx: DBInterface["tx"]) {
    await tx.exec("PRAGMA user_version = 33");
    await tx.exec(`
      CREATE TABLE connections (
        id TEXT PRIMARY KEY,
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
    await tx.exec(`CREATE INDEX idx_connections_service ON connections(service)`);
    await tx.exec(`SELECT crsql_as_crr('connections')`);
  }
  ```
- [x] Register v33 in `packages/db/src/database.ts` migrations Map (after line ~113)
- [x] Create `ConnectionStore` in `packages/db/src/connection-store.ts`:
  - Follow pattern from `packages/db/src/note-store.ts` and `packages/db/src/file-store.ts`
  - Methods: `getConnection`, `listConnections`, `upsertConnection`, `deleteConnection`, `updateLastUsed`
  - Use `this.db.db.execO<Record<string, unknown>>()` for queries
- [x] Add `connectionStore` to `KeepDbApi` class in `packages/db/src/api.ts`:
  ```typescript
  public readonly connectionStore: ConnectionStore;
  // In constructor:
  this.connectionStore = new ConnectionStore(db);
  ```
- [x] Export from `packages/db/src/index.ts`
- [x] Implement startup reconciliation (in server startup):
  - List all credential files in `{userPath}/connectors/*/*`
  - For each, ensure matching db row exists
  - For db rows without files, mark status='error'

**Testing Requirements:**
- [x] Unit tests for ConnectionManager CSRF flow
- [x] Unit tests for token refresh timing logic (mock Date.now)
- [x] Integration tests for file/db reconciliation

**Invariants:**
- Tools MUST specify `accountId` explicitly - no default account fallback
- Missing accountId throws `LogicError` listing available accounts (for agent self-correction)
- File contains OAuth tokens (sensitive), db contains metadata (syncs)
- Status is derived: 'connected' if file exists and not error, 'error' if marked, 'expired' if token expired

**CRSQLite Gotchas (verified in codebase):**
- NOT NULL columns require DEFAULT values (see existing migrations)
- ALTER TABLE requires wrapping in `crsql_begin_alter()`/`crsql_commit_alter()`
- Latest migration is v32 (verified), so connections table goes in v33
- Never do schema ALTER and data UPDATE in same migration transaction

### 1.4 Gmail Refactor (spec: connectors-03-gmail-refactor.md)

**Action Items:**
- [ ] Create `packages/connectors/src/services/google.ts`:
  ```typescript
  const googleOAuthBase = {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  };

  export const gmailService: ServiceDefinition = {
    name: 'gmail',
    oauthConfig: {
      ...googleOAuthBase,
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],  // .modify for read+write
    },
    fetchProfile: async (accessToken) => { /* fetch from userinfo API */ },
    extractAccountId: (profile) => profile.email,
  };
  ```
- [ ] Update `packages/agent/src/tools/gmail.ts`:
  - Change signature: `makeGmailTool(getContext, connectionManager: ConnectionManager)`
  - Add required `account` parameter to input schema
  - Fetch credentials: `const creds = await connectionManager.getCredentials('gmail', input.account)`
  - Create OAuth2 client from credentials (not passed in)
  - On AuthError, call `connectionManager.markError('gmail', input.account, error.message)`
  - Throw `LogicError` if no `account` provided, listing available accounts
- [ ] Update `packages/agent/src/sandbox/api.ts`:
  - Remove `gmailOAuth2Client` from SandboxAPIConfig
  - Add `connectionManager: ConnectionManager` to SandboxAPIConfig
  - Always register Gmail tool (lines 370-375): remove conditional, always call `addTool()`
  - Pass `connectionManager` to `makeGmailTool()`
- [ ] Update worker files to pass `connectionManager` instead of `gmailOAuth2Client`:
  - `packages/agent/src/task-scheduler.ts` - constructor and fields
  - `packages/agent/src/workflow-scheduler.ts` - constructor and fields
  - `packages/agent/src/task-worker.ts` - config and createEnv
  - `packages/agent/src/workflow-worker.ts` - config and createEnv
- [ ] Implement migration logic (in `apps/server/src/server.ts` startup):
  ```typescript
  async function migrateOldGmailCredentials(userPath: string, connectionManager: ConnectionManager) {
    const oldPath = path.join(userPath, 'gmail.json');
    if (!fs.existsSync(oldPath)) return;
    try {
      const tokens = JSON.parse(fs.readFileSync(oldPath, 'utf-8'));
      // Fetch profile to get email
      const profile = await connectionManager.services.gmail.fetchProfile(tokens.access_token);
      const accountId = profile.email;
      await connectionManager.store.save('gmail', accountId, tokens);
      // Add to db
      await connectionManager.db.upsertConnection({
        id: `gmail:${accountId}`, service: 'gmail', accountId, status: 'connected', ...
      });
    } catch (err) {
      console.warn('Gmail migration failed, user will re-auth:', err.message);
    }
    fs.unlinkSync(oldPath);  // Delete old file regardless of success
  }
  ```
- [ ] Remove `oAuth2Client.on("tokens")` listener from server.ts (lines ~165-185)
- [ ] Delete `createGmailOAuth2Client()` function (lines 116-190)
- [ ] Mark old endpoints as deprecated (add console.warn, plan removal in next version)

**Breaking Change:**
- Gmail tool now requires `account` parameter
- Scripts using `Gmail.api({ method: ... })` must become `Gmail.api({ method: ..., account: "user@gmail.com" })`
- Agent will auto-correct if error message lists available accounts

### 1.5 Server Endpoints (spec: connectors-04-server-endpoints.md)

**Action Items:**
- [ ] Create `apps/server/src/routes/connectors.ts`:
  ```typescript
  import { FastifyInstance } from 'fastify';
  import { ConnectionManager } from '@app/connectors';

  export async function registerConnectorRoutes(
    fastify: FastifyInstance,
    connectionManager: ConnectionManager,
    getServerBaseUrl: () => string
  ) {
    // POST /connectors/:service/connect
    fastify.post<{ Params: { service: string } }>('/connectors/:service/connect', async (req) => {
      const redirectUri = `${getServerBaseUrl()}/api/connectors/${req.params.service}/callback`;
      const { authUrl, state } = connectionManager.startOAuthFlow(req.params.service, redirectUri);
      return { authUrl, state };
    });

    // GET /connectors/:service/callback
    fastify.get<{ Params: { service: string }; Querystring: { code: string; state: string } }>(
      '/connectors/:service/callback', async (req, reply) => {
        try {
          const connection = await connectionManager.completeOAuthFlow(
            req.params.service, req.query.code, req.query.state
          );
          return reply.type('text/html').send(successHtml(connection));
        } catch (err) {
          return reply.type('text/html').send(errorHtml(err.message));
        }
      }
    );

    // DELETE /connectors/:service/:accountId
    fastify.delete<{ Params: { service: string; accountId: string } }>(
      '/connectors/:service/:accountId', async (req) => {
        await connectionManager.disconnect(req.params.service, req.params.accountId);
        return { success: true };
      }
    );

    // POST /connectors/:service/:accountId/check
    fastify.post<{ Params: { service: string; accountId: string } }>(
      '/connectors/:service/:accountId/check', async (req) => {
        const creds = await connectionManager.getCredentials(req.params.service, req.params.accountId);
        // Service-specific check (e.g., Gmail profile fetch)
        return { connected: true, accountId: req.params.accountId };
      }
    );
  }
  ```
- [ ] Create HTML response templates:
  ```typescript
  const successHtml = (connection: Connection) => `
    <!DOCTYPE html><html><body>
    <h1>Connected!</h1><p>Account: ${connection.accountId}</p>
    <script>setTimeout(() => window.close(), 2000)</script>
    </body></html>
  `;
  const errorHtml = (message: string) => `
    <!DOCTYPE html><html><body>
    <h1>Connection Failed</h1><p>${message}</p>
    </body></html>
  `;
  ```
- [ ] Register routes in `apps/server/src/server.ts` (after line ~793):
  ```typescript
  await app.register(
    async function (fastify) {
      await registerConnectorRoutes(fastify, connectionManager, () => `http://127.0.0.1:${PORT}`);
    },
    { prefix: "/api" }
  );
  ```
- [ ] Helper function `getServerBaseUrl()`:
  - Use `127.0.0.1:PORT` (more reliable than `localhost` for OAuth)
  - PORT default: 4681 (from existing server config)
- [ ] Mark old Gmail endpoints as deprecated (add `// DEPRECATED` comments, log warnings)

**OAuth Provider Configuration Required:**
- Register redirect URIs in Google Cloud Console:
  - `http://127.0.0.1:4681/api/connectors/gmail/callback`
  - `http://localhost:4681/api/connectors/gmail/callback` (fallback)
  - Same pattern for gdrive, gsheets, gdocs
- Register in Notion Developer Portal:
  - `http://127.0.0.1:4681/api/connectors/notion/callback`
  - `http://localhost:4681/api/connectors/notion/callback`

**Note:** Callback returns HTML page that auto-closes. No postMessage needed - connection appears via db sync.

### 1.6 Connections UI (spec: connectors-05-ui-connections-page.md)

**Action Items:**
- [ ] Add query keys to `apps/web/src/hooks/queryKeys.ts`:
  ```typescript
  allConnections: () => [{ scope: "allConnections" }] as const,
  connection: (connectionId: string) => [{ scope: "connection", connectionId }] as const,
  connectionsByService: (service: string) => [{ scope: "connectionsByService", service }] as const,
  ```
- [ ] Create `apps/web/src/hooks/dbConnectionReads.ts`:
  ```typescript
  import { useQuery } from "@tanstack/react-query";
  import { qk } from "./queryKeys";
  import { useDbQuery } from "./dbQuery";

  export function useConnections() {
    const { api } = useDbQuery();
    return useQuery({
      queryKey: qk.allConnections(),
      queryFn: async () => {
        if (!api) return [];
        return await api.connectionStore.listConnections();
      },
      meta: { tables: ["connections"] },  // CRITICAL: enables auto-invalidation
      enabled: !!api,
    });
  }
  ```
- [ ] Add Radix Tabs component (if not present) - check `@radix-ui/react-tabs` in package.json
- [ ] Update `apps/web/src/components/SettingsPage.tsx`:
  - Import Tabs components
  - Wrap current content in `<TabsContent value="general">`
  - Add `<TabsContent value="connections">` for new section
  - Add `<TabsList>` with "General" and "Connections" triggers
- [ ] Create `apps/web/src/components/ConnectionCard.tsx`:
  - Props: `connection: Connection, onRename, onDisconnect, onReconnect`
  - Status badge: green (connected), yellow (expired), red (error)
  - Dropdown menu: Rename, Check, Disconnect
  - Show error message when status='error'
- [ ] Create `apps/web/src/components/AddServiceModal.tsx`:
  - Grid of available services (Gmail, Drive, Sheets, Docs, Notion)
  - Click triggers OAuth flow
- [ ] Implement OAuth popup flow:
  ```typescript
  const handleConnect = async (service: string) => {
    const res = await fetch(`/api/connectors/${service}/connect`, { method: 'POST' });
    const { authUrl } = await res.json();
    window.open(authUrl, '_blank', 'width=600,height=700');
    // Connection appears via db sync - useConnections() auto-updates
  };
  ```
- [ ] Create rename modal (simple input with save/cancel)
- [ ] Create disconnect confirmation modal (warn about automation impact)
- [ ] Handle reconnect: same as connect, reuses existing accountId

**UI States:**
- connected: green badge, normal card
- expired: yellow badge, "Reconnect" button prominent
- error: red badge with error message, "Reconnect" button, "Check" to retry

**Important Correction:**
- The codebase uses **TanStack Query (React Query)**, NOT Dexie's useLiveQuery
- Reactivity is via `meta: { tables: [...] }` which triggers auto-invalidation when table changes
- See `apps/web/src/queryClient.ts` for the invalidation mechanism

### 1.7 Additional Connectors

#### 1.7a Google Services (spec: connectors-06-google-services.md)

**Action Items:**
- [ ] Add service definitions to `packages/connectors/src/services/google.ts`:
  ```typescript
  export const gdriveService: ServiceDefinition = {
    name: 'gdrive',
    oauthConfig: { ...googleOAuthBase, scopes: ['https://www.googleapis.com/auth/drive'] },
    fetchProfile: fetchGoogleProfile,
    extractAccountId: (profile) => profile.email,
  };
  // Similar for gsheetsService (spreadsheets scope), gdocsService (documents scope)
  ```
- [ ] Create `packages/agent/src/tools/google-common.ts`:
  ```typescript
  export async function getGoogleOAuthClient(connectionManager: ConnectionManager, service: string, accountId: string) {
    const creds = await connectionManager.getCredentials(service, accountId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: creds.access_token, refresh_token: creds.refresh_token });
    return oauth2Client;
  }
  ```
- [ ] Implement `packages/agent/src/tools/gdrive.ts`:
  - Methods: `files.list`, `files.get`, `files.create`, `files.update`, `files.export`
  - Required `account` parameter
  - Use `classifyGoogleApiError()` for error handling
- [ ] Implement `packages/agent/src/tools/gsheets.ts`:
  - Methods: `spreadsheets.get`, `spreadsheets.values.get`, `spreadsheets.values.update`, `spreadsheets.values.append`, `spreadsheets.batchUpdate`
  - Required `account` parameter
- [ ] Implement `packages/agent/src/tools/gdocs.ts`:
  - Methods: `documents.get`, `documents.batchUpdate`
  - Required `account` parameter
- [ ] Register all tools in `packages/agent/src/sandbox/api.ts`:
  ```typescript
  addTool(global, "GDrive", "api", makeGDriveTool(this.getContext, this.connectionManager));
  addTool(global, "GSheets", "api", makeGSheetsTool(this.getContext, this.connectionManager));
  addTool(global, "GDocs", "api", makeGDocsTool(this.getContext, this.connectionManager));
  ```
- [ ] Export from `packages/agent/src/tools/index.ts`
- [ ] Register redirect URIs in Google Cloud Console (see 1.5)

**Decision:** Using Option A (separate connections per service) for v1 - simpler. Can optimize to incremental scopes later.

#### 1.7b Notion Connector (spec: connectors-07-notion.md)

**Action Items:**
- [ ] Create `packages/connectors/src/services/notion.ts`:
  ```typescript
  export const notionService: ServiceDefinition = {
    name: 'notion',
    oauthConfig: {
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      tokenUrl: 'https://api.notion.com/v1/oauth/token',
      scopes: [],  // Notion doesn't use scopes in URL
      extraAuthParams: { owner: 'user' },
      useBasicAuth: true,  // Flag for token exchange
    },
    fetchProfile: null,  // Profile comes in token response
    extractAccountId: (tokenResponse) => tokenResponse.workspace_id,
    extractDisplayName: (tokenResponse) => tokenResponse.workspace_name,
  };
  ```
- [ ] Update `packages/connectors/src/oauth.ts` to support Basic auth:
  ```typescript
  if (config.useBasicAuth) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }
  ```
- [ ] Implement `packages/agent/src/tools/notion.ts`:
  - Methods: `databases.query`, `databases.retrieve`, `pages.retrieve`, `pages.create`, `pages.update`, `blocks.children.list`, `blocks.children.append`, `search`
  - Required `account` parameter (workspace_id)
  - Use `@notionhq/client` SDK
- [ ] Add `classifyNotionError()` to `packages/agent/src/errors.ts`:
  ```typescript
  export function classifyNotionError(err: any, source?: string): ClassifiedError {
    const status = err?.status || err?.response?.status;
    if (typeof status === 'number') {
      return classifyHttpError(status, err.message, { cause: err, source });
    }
    // Notion-specific patterns
    if (err?.code === 'unauthorized') return new AuthError('Notion access revoked', { cause: err, source });
    return classifyGenericError(err, source);
  }
  ```
- [ ] Add `@notionhq/client: ^2.2.0` to `packages/agent/package.json`
- [ ] Register Notion tool in SandboxAPI
- [ ] Update UI to display `workspace_name` instead of `workspace_id`:
  - Store `workspace_name` in `connections.metadata` JSON field
  - ConnectionCard shows `connection.metadata?.workspace_name || connection.accountId`

**Notion-specific:**
- Tokens don't expire - `getCredentials()` just returns stored token
- Uses Basic auth for token exchange (not standard OAuth2)
- Account ID is `workspace_id`, display as `workspace_name`
- Token response includes: `workspace_id`, `workspace_name`, `workspace_icon`, `bot_id`, `owner`

---

## Priority 2: Core Automation Reliability

Essential fixes and improvements for workflow reliability in v1.

### 2.1 Error Handling Improvements
- [ ] Add `classifyNotionError()` function (part of Notion connector - see 1.7b)
- [ ] Review existing error classification completeness for Google APIs
- [ ] Ensure all tools use appropriate error classification

### 2.2 Technical Debt (From FIXME/TODO Comments)

**BLOCKING for v1:**
- [ ] `packages/sync/src/TransportClientHttp.ts:176` - Node.js EventSource not implemented
  - Currently throws "EventSource not available" for Node.js SSE transport
  - Blocks server-side SSE sync; browser works fine
  - **Recommended: Option A** - use `eventsource` npm package (minimal, focused dependency)
  - Implementation:
    ```typescript
    let EventSourceImpl: typeof EventSource;
    if (typeof EventSource !== "undefined") {
      EventSourceImpl = EventSource;
    } else {
      EventSourceImpl = require('eventsource');
    }
    // Use EventSourceImpl in connectSSE()
    ```

**Nice-to-have (non-blocking):**
- [ ] `packages/sync/src/nostr/stream/StreamWriter.ts:515` - Find optimal chunk size for high bandwidth
  - Current: hardcoded limit of 10 pending chunks
  - Needs performance testing to find optimal value
- [ ] `packages/sync/src/Peer.ts:788` - Ensure tx delivery by organizing change batches properly
  - Related to CRSQLite change synchronization edge cases

### 2.3 Skipped Tests Triage (Verified)

**WebSocket/Network-dependent (3 test suites):**
- [ ] `packages/tests/src/nostr-transport.test.ts:34,79` - 2 skipped tests (peer connection, invalid secret rejection)
- [ ] `packages/tests/src/nostr-transport-sync.test.ts:70` - Entire suite skipped (6 tests, needs real WebSocket)
- [ ] `packages/tests/src/crsqlite-peer-new.test.ts:102` - Entire suite skipped (5 tests, needs P2P setup)

**Other skipped tests:**
- [ ] `packages/tests/src/file-transfer.test.ts:437` - Real signers and encryption test
- [ ] `packages/tests/src/exec-many-args-browser.test.ts:7` - Browser-specific (needs IndexedDB/WASM)

**Assessment:** These tests require actual network/WebSocket infrastructure or browser environment. For v1, document as integration tests that run in specific environments. Not blocking.

### 2.4 Type Safety Cleanup (8 @ts-ignore found)

**Critical (potential bugs):**
- [ ] `packages/agent/src/task-worker.ts:694` - Array mapping returns undefined on JSON.parse error
  - Fix: Add `.filter(Boolean)` or explicit undefined handling

**Library type issues (low priority):**
- [ ] `packages/browser/src/startWorker.ts:74` - SharedWorker module type options
- [ ] `packages/agent/src/agent.ts:256,315,338` - AI SDK provider metadata types, UIMessage stream
- [ ] `apps/web/src/ui/components/ai-elements/prompt-input.tsx:524` - Clipboard items iterator
- [ ] `apps/web/src/db.ts:2` - Vite WASM import query parameter
- [ ] `apps/server/src/server.ts:789,1846` - Fastify plugin and static file types

**Recommendation:** Fix the task-worker.ts issue (real bug). Others are workarounds for incomplete third-party types.

### 2.5 Empty Catch Blocks (Code Quality)

Found 18+ instances of empty catch blocks. Most are intentional for cleanup operations, but one is problematic:
- [ ] `packages/agent/src/task-worker.ts:703` - JSON parse error silently swallowed
  - Should at least log warning: `console.warn('Failed to parse inbox item:', i.id, e)`

---

## Priority 3: User Experience Polish (Essential for v1)

These features significantly improve user confidence and experience.

### 3.1 Workflow Dry-Run Testing (idea: dry-run-testing.md)

**Action Items:**
- [ ] Add "Test run" button to workflow detail page (`apps/web/src/components/WorkflowDetailPage.tsx`)
- [ ] Create server endpoint `POST /api/workflow/:id/test-run`
- [ ] Modify `script_runs` insertion to support `type="dry_run"` marker
- [ ] Execute script normally in sandbox (reads are real, QuickJS provides isolation)
- [ ] Show results in chat with clear "Test Run Completed" or "Test Run Failed" message
- [ ] Add styling to distinguish test run events (gray/muted vs normal)

**Already Exists:**
- `script_runs` table with `type` column
- `WorkflowWorker` executes scripts in QuickJS sandbox (16MB memory, 300s timeout)

### 3.2 Event Timeline Improvements

#### 3.2a Highlight Significant Events (idea: highlight-significant-events.md)

**Action Items:**
- [ ] Add `significance: EventSignificance` to `EventConfig` in `apps/web/src/types/events.ts`:
  ```typescript
  export type EventSignificance = 'normal' | 'error' | 'success' | 'user' | 'state' | 'write';
  ```
- [ ] Update `EVENT_CONFIGS` with significance for each event type:
  - `create_note`, `update_note`, `file_save`, `add_script` → `write`
  - `gmail_api_call`, `web_fetch`, `web_search` → `normal`
  - Future error events → `error`
- [ ] Update `apps/web/src/components/EventItem.tsx` with significance-based styling:
  - Error: `border-red-200 bg-red-50 text-red-700`
  - Success: `border-green-200 bg-green-50 text-green-700`
  - User: `border-blue-200 bg-blue-50 text-blue-700`
  - State: `border-yellow-200 bg-yellow-50 text-yellow-700`
  - Write: `border-gray-200 bg-white text-gray-700`
- [ ] Update `WorkflowEventGroup.tsx` and `TaskEventGroup.tsx` to show status in headers:
  - Red left border if any error event
  - Green indicator if fix after failure

#### 3.2b Collapse Low-Signal Events (idea: collapse-low-signal-events.md)

**Action Items:**
- [ ] Create `apps/web/src/lib/eventSignal.ts`:
  ```typescript
  export type SignalLevel = 'high' | 'low';
  const LOW_SIGNAL_EVENTS = ['web_fetch', 'web_search', 'get_weather', 'text_extract', ...];
  export function getEventSignalLevel(type, payload): SignalLevel { ... }
  ```
- [ ] Create `apps/web/src/components/CollapsedEventSummary.tsx`:
  - Shows "X routine events (type1, type2, ...)" with expand/collapse toggle
- [ ] Update `WorkflowEventGroup.tsx`:
  - Add `isCollapsed` state (default: true)
  - Partition events into high/low signal
  - Render high-signal events normally, collapse low-signal
  - Auto-expand if any errors present
- [ ] Apply same changes to `TaskEventGroup.tsx`

**Effort:** Small (2-4 hours), purely UI change, no backend needed

### 3.3 Draft Management (idea: handle-abandoned-drafts.md)

**For v1 (simplest approach):**
- [ ] Leave drafts in Draft status forever (no auto-archive)
- [ ] Optionally add gentle reminder notification after 3+ days inactive

**Future (post-v1):**
- Define abandoned draft detection (no activity for X days)
- Add archive status to hide from main list
- Add "stale drafts" banner on main page

### 3.4 In-App Bug Reporting (idea: in-app-bug-report.md)

**Action Items:**
- [ ] Add "Report Issue" button to error notifications
- [ ] Create bug report form modal with pre-filled context:
  - Error message
  - Workflow/task ID and name
  - Timestamp
  - Script version (if applicable)
  - Anonymized logs (last N events)
- [ ] Integration option: GitHub Issues URL with pre-filled template
  - Format: `https://github.com/org/repo/issues/new?title=...&body=...`
- [ ] Alternative: mailto link with pre-filled subject/body

---

## Priority 4: Nice-to-Have for v1

Lower priority but would enhance the release.

### 4.1 Agent Status (idea: agent-status-from-active-runs.md)
- [ ] Derive agent status from active task_runs/script_runs queries
- [ ] Handle orphaned runs on startup (mark as "interrupted")
- [ ] Display combined status in UI header

### 4.2 Archive Old Drafts
- [ ] Add "Archive" action for drafts
- [ ] Archived drafts hidden from main list, viewable in separate section

---

## Priority 5: Post-v1 Features

Not in scope for v1.0.0 release.

### 5.1 Monetization (idea: user-balance-and-payments.md)
- User balance display
- Stripe integration for top-up
- PAYMENT_REQUIRED error handling
- Usage tracking

### 5.2 Support Infrastructure
- "Contact Support" action in error notifications
- Pre-filled bug report form
- Support system integration

### 5.3 Script Management
- Script versioning (idea: script-versioning.md)
- Script diff view (idea: script-diff-view.md)

### 5.4 Additional Features
- Push notifications (partially supported)
- Incremental OAuth scopes for Google services
- OS keystore integration for credential encryption
- Simplify question-answering workflow

---

## Implementation Order

```
Phase 1: Connectors Foundation
  1.1 Build secrets → 1.2 Core package → 1.3 Connection Manager + DB

Phase 2: Gmail Migration
  1.4 Gmail refactor → 1.5 Server endpoints

Phase 3: UI + Additional Services
  1.6 Connections UI → 1.7a Google Services → 1.7b Notion

Phase 4: Polish + Testing
  2.1-2.4 Technical debt triage
  3.1-3.4 UX improvements
  End-to-end testing of connector flows
```

---

## Key Constraints and Invariants

### OAuth Security
- Desktop app client secrets are public - security relies on redirect URI validation
- Always use 127.0.0.1 for local OAuth (more reliable than localhost)
- Register both 127.0.0.1 and localhost variants in OAuth provider consoles

### Multi-Account Design
- Tools MUST require explicit `accountId` parameter
- No "default account" fallback - prevents accidental account mixing
- Error messages list available accounts to help agent self-correct
- SandboxAPI always registers tools - connection check happens internally when tool is called

### Data Storage Split
- **Files**: OAuth tokens (sensitive) - `{userPath}/connectors/{service}/{accountId}.json`
- **Database**: Connection metadata (non-sensitive) - syncs to all clients via CRSQLite

### Package Dependencies
- `@app/connectors` must NOT import `@app/db` directly
- Database interface is injected via ConnectionManager constructor
- Keeps connectors package testable and portable

### UI Reactivity
- Connection changes appear via database sync (**TanStack Query with table invalidation**, NOT useLiveQuery)
- Pattern: `useQuery({ ..., meta: { tables: ["connections"] } })`
- Auto-invalidation via `queryClient.ts` `notifyTablesChanged()` function
- No postMessage needed from OAuth callback
- OAuth callback returns HTML that auto-closes
- Settings page uses tab pattern for Connections section (add Radix Tabs)

### Database Migrations
- Current latest: v32
- Next migration (connections table): v33
- CRSQLite constraints: NOT NULL needs DEFAULT, ALTER TABLE needs crsql_begin_alter/crsql_commit_alter

### Testing Standards
- Use Vitest for packages, Jest for apps
- Security-critical code targets:
  - OAuth handler: 95%+ coverage
  - Credential store: 98%+ coverage
  - Connection manager: 85%+ coverage

### Migration
- Old gmail.json migrated to new location on first load
- Migration failure (expired token) just deletes old file - user re-auths
- Startup reconciliation syncs file state with database state
