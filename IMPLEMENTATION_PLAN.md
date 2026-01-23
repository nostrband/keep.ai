# Keep.AI v1.0.0 Implementation Plan

> **Note (2026-01-23):** Sections 1.1 (Build-Time Secrets), 1.2 (Core Connectors Package), 1.3 (Connection Manager + Database), 1.4 (Gmail Refactor), 1.5 (Server Endpoints), 1.6 (Connections UI), and 1.7b (Notion Connector) are now fully implemented.
>
> **Note (2026-01-23):** Code cleanup completed: TaskState struct removed (Spec 10 completion), Tasks.* tools deprecated and moved to `packages/agent/src/tools/deprecated/`.

## Priority 1: Connectors Framework (Current Focus - BLOCKING)

The connectors framework enables multi-account OAuth connections for Gmail and other services. This is the current development focus and blocks all new service integrations.

**Current State (Updated 2026-01-23):**
- `packages/connectors` is fully implemented with:
  - OAuth2 handler, credential store, connection manager, database adapter
  - Google service definitions (Gmail, Drive, Sheets, Docs)
  - Type-safe interfaces for multi-account support
- New generic endpoints at `/api/connectors/*`:
  - `POST /api/connectors/:service/connect` - Start OAuth flow
  - `GET /api/connectors/:service/callback` - OAuth callback
  - `DELETE /api/connectors/:service/:accountId` - Disconnect
  - `POST /api/connectors/:service/:accountId/check` - Test connection
- Old Gmail endpoints deprecated (warnings logged, still functional for backwards compatibility)
- Credentials stored per-account at `{userPath}/connectors/{service}/{accountId}.json`
- Connection metadata in database `connections` table (syncs across clients)
- Gmail tool uses ConnectionManager for credentials (multi-account ready)

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

### 1.4 Gmail Refactor (spec: connectors-03-gmail-refactor.md) - FULLY IMPLEMENTED

**Action Items:**
- [x] Create `packages/connectors/src/services/google.ts`:
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
- [x] Update `packages/agent/src/tools/gmail.ts`:
  - Change signature: `makeGmailTool(getContext, connectionManager: ConnectionManager)`
  - Add required `account` parameter to input schema
  - Fetch credentials: `const creds = await connectionManager.getCredentials('gmail', input.account)`
  - Create OAuth2 client from credentials (not passed in)
  - On AuthError, call `connectionManager.markError('gmail', input.account, error.message)`
  - Throw `LogicError` if no `account` provided, listing available accounts
- [x] Update `packages/agent/src/sandbox/api.ts`:
  - Remove `gmailOAuth2Client` from SandboxAPIConfig
  - Add `connectionManager: ConnectionManager` to SandboxAPIConfig
  - Always register Gmail tool (lines 370-375): remove conditional, always call `addTool()`
  - Pass `connectionManager` to `makeGmailTool()`
- [x] Update worker files to pass `connectionManager` instead of `gmailOAuth2Client`:
  - `packages/agent/src/task-scheduler.ts` - constructor and fields
  - `packages/agent/src/workflow-scheduler.ts` - constructor and fields
  - `packages/agent/src/task-worker.ts` - config and createEnv
  - `packages/agent/src/workflow-worker.ts` - config and createEnv
- [x] Implement migration logic (in `apps/server/src/server.ts` startup):
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
- [x] Remove `oAuth2Client.on("tokens")` listener from server.ts (lines ~165-185)
- [x] Delete `createGmailOAuth2Client()` function (lines 116-190)
- [x] Mark old endpoints as deprecated (add console.warn, plan removal in next version)

**Breaking Change:**
- Gmail tool now requires `account` parameter
- Scripts using `Gmail.api({ method: ... })` must become `Gmail.api({ method: ..., account: "user@gmail.com" })`
- Agent will auto-correct if error message lists available accounts

### 1.5 Server Endpoints (spec: connectors-04-server-endpoints.md) - FULLY IMPLEMENTED

**Action Items:**
- [x] Create `apps/server/src/routes/connectors.ts` with all endpoints:
  - `POST /connectors/:service/connect` - Start OAuth flow
  - `GET /connectors/:service/callback` - OAuth callback with HTML responses
  - `DELETE /connectors/:service/:accountId` - Disconnect
  - `POST /connectors/:service/:accountId/check` - Test connection with profile fetch
  - `GET /connectors/list` - List all connections
  - `GET /connectors/:service/list` - List connections by service
  - `GET /connectors/services` - List available services
- [x] Create HTML response templates with styled success/error pages, auto-close with countdown
- [x] Register routes in `apps/server/src/server.ts` under `/api` prefix
- [x] Helper function `getServerBaseUrl()` using `127.0.0.1:PORT`
- [x] Register all Google services (Gmail, Drive, Sheets, Docs) in ConnectionManager
- [x] Mark old Gmail endpoints as deprecated (log warnings via debugServer)

**OAuth Provider Configuration Required:**
- Register redirect URIs in Google Cloud Console:
  - `http://127.0.0.1:4681/api/connectors/gmail/callback`
  - `http://localhost:4681/api/connectors/gmail/callback` (fallback)
  - Same pattern for gdrive, gsheets, gdocs
- Register in Notion Developer Portal:
  - `http://127.0.0.1:4681/api/connectors/notion/callback`
  - `http://localhost:4681/api/connectors/notion/callback`

**Note:** Callback returns HTML page that auto-closes. No postMessage needed - connection appears via db sync.

### 1.6 Connections UI (spec: connectors-05-ui-connections-page.md) - FULLY IMPLEMENTED

**Action Items:**
- [x] Add query keys to `apps/web/src/hooks/queryKeys.ts`:
  - `allConnections`, `connection`, `connectionsByService`
- [x] Create `apps/web/src/hooks/dbConnectionReads.ts`:
  - `useConnections()`, `useConnection()`, `useConnectionsByService()` hooks
  - Uses TanStack Query with `meta: { tables: ["connections"] }` for auto-invalidation
- [x] Create `apps/web/src/components/ConnectionsSection.tsx`:
  - Full-featured component with:
    - Service groups (Gmail, Google Drive, Sheets, Docs)
    - Connection cards with status badges (green/yellow/red)
    - Dropdown menu (Rename, Check, Reconnect, Disconnect)
    - Inline rename UI with input field
    - Error message display for failed connections
    - OAuth popup flow with pending state
- [x] Update `apps/web/src/components/SettingsPage.tsx`:
  - Removed old Gmail-specific integration code
  - Added ConnectionsSection below main configuration form
  - Clean separation of concerns
- [x] Implement connection label persistence via useUpdateConnectionLabel hook

**Implementation Notes:**
- Used a section-based layout instead of tabs (simpler, all on one page)
- Combined ConnectionCard and AddServiceModal functionality into a single ServiceGroup component
- No disconnect confirmation modal (simple delete for v1, can add later if needed)
- Connection label persistence: implemented via `useUpdateConnectionLabel` hook which persists user-provided labels to the database `connections.label` field
- Rename updates persist across sessions (labels stored in database)

### 1.7 Additional Connectors

#### 1.7a Google Services (spec: connectors-06-google-services.md)

**Action Items:**
- [x] Add service definitions to `packages/connectors/src/services/google.ts`:
  ```typescript
  export const gdriveService: ServiceDefinition = {
    name: 'gdrive',
    oauthConfig: { ...googleOAuthBase, scopes: ['https://www.googleapis.com/auth/drive'] },
    fetchProfile: fetchGoogleProfile,
    extractAccountId: (profile) => profile.email,
  };
  // Similar for gsheetsService (spreadsheets scope), gdocsService (documents scope)
  ```
- [x] Create `packages/agent/src/tools/google-common.ts`:
  ```typescript
  export async function getGoogleOAuthClient(connectionManager: ConnectionManager, service: string, accountId: string) {
    const creds = await connectionManager.getCredentials(service, accountId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: creds.access_token, refresh_token: creds.refresh_token });
    return oauth2Client;
  }
  ```
- [x] Implement `packages/agent/src/tools/gdrive.ts`:
  - Methods: `files.list`, `files.get`, `files.create`, `files.update`, `files.export`
  - Required `account` parameter
  - Use `classifyGoogleApiError()` for error handling
- [x] Implement `packages/agent/src/tools/gsheets.ts`:
  - Methods: `spreadsheets.get`, `spreadsheets.values.get`, `spreadsheets.values.update`, `spreadsheets.values.append`, `spreadsheets.batchUpdate`
  - Required `account` parameter
- [x] Implement `packages/agent/src/tools/gdocs.ts`:
  - Methods: `documents.get`, `documents.batchUpdate`
  - Required `account` parameter
- [x] Register all tools in `packages/agent/src/sandbox/api.ts`:
  ```typescript
  addTool(global, "GDrive", "api", makeGDriveTool(this.getContext, this.connectionManager));
  addTool(global, "GSheets", "api", makeGSheetsTool(this.getContext, this.connectionManager));
  addTool(global, "GDocs", "api", makeGDocsTool(this.getContext, this.connectionManager));
  ```
- [x] Export from `packages/agent/src/tools/index.ts`
- [ ] Register redirect URIs in Google Cloud Console:
  - Requires manual configuration in Google Cloud Console
  - Register the following redirect URIs for each service (Gmail already done in 1.5):
    - `http://127.0.0.1:4681/api/connectors/gdrive/callback`
    - `http://localhost:4681/api/connectors/gdrive/callback`
    - `http://127.0.0.1:4681/api/connectors/gsheets/callback`
    - `http://localhost:4681/api/connectors/gsheets/callback`
    - `http://127.0.0.1:4681/api/connectors/gdocs/callback`
    - `http://localhost:4681/api/connectors/gdocs/callback`

**Decision:** Using Option A (separate connections per service) for v1 - simpler. Can optimize to incremental scopes later.

**Note:** The Google Cloud Console redirect URI registration is an external manual step that users must complete in their Google Cloud project settings. This cannot be automated and must be done before users can authenticate with Google Drive, Sheets, or Docs services.

#### 1.7b Notion Connector (spec: connectors-07-notion.md) - FULLY IMPLEMENTED

**Action Items:**
- [x] Create `packages/connectors/src/services/notion.ts`:
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
- [x] Update `packages/connectors/src/oauth.ts` to support Basic auth:
  ```typescript
  if (config.useBasicAuth) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }
  ```
- [x] Implement `packages/agent/src/tools/notion.ts`:
  - Methods: `databases.query`, `databases.retrieve`, `pages.retrieve`, `pages.create`, `pages.update`, `blocks.children.list`, `blocks.children.append`, `search`
  - Required `account` parameter (workspace_id)
  - Use `@notionhq/client` SDK
- [x] Add `classifyNotionError()` to `packages/agent/src/errors.ts`:
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
- [x] Add `@notionhq/client: ^2.2.0` to `packages/agent/package.json`
- [x] Export Notion service from `packages/connectors/src/index.ts`
- [x] Register Notion service in `apps/server/src/server.ts`
- [x] Register Notion tool in `packages/agent/src/sandbox/api.ts`
- [x] Export Notion tool from `packages/agent/src/tools/index.ts`
- [x] Update UI ConnectionsSection to include Notion service with `workspace_name` display
  - Stores `workspace_name` in `connections.metadata` JSON field
  - ConnectionCard shows `connection.metadata?.workspace_name || connection.accountId`
- [ ] Register redirect URIs in Notion Developer Portal (user-facing configuration):
  - `http://127.0.0.1:4681/api/connectors/notion/callback`
  - `http://localhost:4681/api/connectors/notion/callback`
  - **Note:** This is a manual step users must complete in their Notion OAuth app settings before they can authenticate.

**Notion-specific:**
- Tokens don't expire - `getCredentials()` just returns stored token
- Uses Basic auth for token exchange (not standard OAuth2)
- Account ID is `workspace_id`, display as `workspace_name`
- Token response includes: `workspace_id`, `workspace_name`, `workspace_icon`, `bot_id`, `owner`

---

## Bug Fixes Completed (2026-01-23)

- [x] **add-task-creation-error-toast.md** - Added error toast notification to MainPage when task creation fails. Previously errors were only logged to console.

- [x] **add-file-upload-failure-warning.md** - Added warning notification when file uploads fail during task creation. User now sees a warning that files failed to upload.

- [x] **add-http-status-check-useNeedAuth.md** - Added HTTP status validation in useNeedAuth.ts before parsing JSON from /check_config endpoint. Improves error handling.

- [x] **wrap-activate-script-in-transaction.md** - Wrapped useActivateScriptVersion mutation in database transaction to prevent TOCTOU vulnerability. Added tx parameter to ScriptStore.getScript() method.

## Code Quality Refactors Completed (2026-01-23)

- [x] **move-format-cron-to-lib.md** - Moved `formatCronSchedule` from WorkflowInfoBox.tsx to `lib/formatCronSchedule.ts`. Added try-catch error handling to prevent UI crashes on malformed cron expressions.

- [x] **add-error-handling-cron-display.md** - Combined with above. Function now returns raw cron string as fallback on any error.

- [x] **centralize-header-height-variable.md** - Added `--header-height` CSS variable in index.css. Updated ChatDetailPage sticky element to use the variable.

- [x] **centralize-workflow-title-fallback.md** - Created `lib/workflowUtils.ts` with `getWorkflowTitle()` function. Updated 7 locations across MainPage, WorkflowDetailPage, TaskDetailPage, ArchivedPage, WorkflowsPage, and WorkflowInfoBox.

- [x] **extract-is-running-hook.md** - Added `isScriptRunRunning()` utility to workflowUtils.ts. Updated MainPage to use the shared utility.

- [x] **simplify-chatpage-disabled-logic.md** - Simplified `disabled={(!input && !uploadState.isUploading) || uploadState.isUploading}` to `disabled={!input || uploadState.isUploading}` in ChatPage, ChatDetailPage, MainPage, and NewPage.

- [x] **fix-pause-notification-grammar.md** - Fixed grammatically incorrect notification message in App.tsx. Now uses correct subject-verb agreement: "has been paused" for count=1 and "have been paused" for count>1.

- [x] **fix-notification-workflow-name-fallback.md** - Changed WorkflowNotifications.ts to use `getWorkflowTitle()` utility instead of hardcoded "Untitled" fallback, ensuring consistent "New workflow" fallback across the application.

- [x] **extract-db-run-promise-utility.md** - Created shared `dbRun()` utility in apps/user-server/src/__tests__/helpers.ts to replace duplicated Promise wrapper patterns for sqlite3's callback-based db.run(). Updated database.test.ts, integration.test.ts, and server.test.ts to use the new utility.

## Additional Fixes Completed (2026-01-23)

- [x] **fix-server-test-async-pattern.md** - Fixed 3 instances of incorrectly awaiting sqlite3's callback-based `db.run()` method in server.test.ts by wrapping them in Promises with resolve/reject pattern, matching the fix already applied to database.test.ts and integration.test.ts.

- [x] **handle-notification-return-in-app.md** - Added return value checking for `window.electronAPI.showNotification` calls in App.tsx handlePauseAllAutomations. Now logs warnings when notifications fail to show, improving debuggability.

- [x] **fix-agent-system-prompts.md** - Updated worker/planner system prompts in agent-env.ts to remove references to removed goal/notes/plan fields. Now correctly references only the "asks" field that is available after Spec 10 changes.

- [x] **complete-chat-messages-migration.md** - Already completed. Server.ts and CLI already use `getNewChatMessages()` instead of deprecated `getChatMessages()`.

## Spec 10 Completion (TaskState Cleanup) - Completed 2026-01-23

- [x] **remove-taskstate-struct.md** - Removed obsolete TaskState type/interface entirely:
  - Deleted `TaskState` type from `packages/agent/src/agent-types.ts`
  - Deleted `TaskState` interface and deprecated methods (`saveState`, `getState`, `getStates`) from `packages/db/src/task-store.ts`
  - Updated all references to use `task.asks` directly
  - Removed `useTaskState` hook from `apps/web/src/hooks/dbTaskReads.ts`
  - Introduced `TaskPatch` type for step output patches (just `asks` field)
  - Removed deprecated tests for task_states table operations

- [x] **deprecate-tasks-api-tools.md** - Removed Tasks.* tools from sandbox API:
  - Removed `Tasks.get`, `Tasks.list`, `Tasks.sendToTaskInbox`, `Tasks.update` from sandbox API registration
  - Moved 6 task tool files to `packages/agent/src/tools/deprecated/` folder:
    - `add-task.ts`, `add-task-recurring.ts`, `get-task.ts`, `list-tasks.ts`, `send-to-task-inbox.ts`, `task-update.ts`
  - Added `@deprecated` JSDoc comments to all deprecated tool files
  - Updated system prompts in `agent-env.ts` to remove task management references
  - Removed "Other tasks" section from worker prompt and "Workflow Title" section from planner prompt

---

## Priority 2: Core Automation Reliability

Essential fixes and improvements for workflow reliability in v1.

### 2.1 Error Handling Improvements - COMPLETED
- [x] Add `classifyNotionError()` function - Implemented in packages/agent/src/errors.ts
- [x] Review existing error classification completeness for Google APIs - **Verified 2026-01-23**
  - All 4 Google tools (gmail, gdrive, gsheets, gdocs) use `classifyGoogleApiError`
- [x] Ensure all tools use appropriate error classification - **Verified 2026-01-23**
  - All 18 external API tools are properly classified:
    - Google APIs → `classifyGoogleApiError`
    - Notion API → `classifyNotionError`
    - OpenRouter/Web APIs → `classifyHttpError` + `classifyGenericError`

### 2.2 Technical Debt (From FIXME/TODO Comments)

**BLOCKING for v1:**
- [x] `packages/sync/src/TransportClientHttp.ts:176` - Node.js EventSource - **COMPLETED**
  - Implemented using `eventsource` npm package (v4.1.0)
  - Added `getEventSource()` function that returns browser native or Node.js polyfill
  - Works in both browser and Node.js environments

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
- [x] `packages/agent/src/task-worker.ts:696` - Fixed empty catch block. Now logs warning: `console.warn("Failed to parse inbox item:", i.id, e)`. Also removed @ts-ignore by adding proper type annotation to filter callback.

**Library type issues (low priority):**
- [ ] `packages/browser/src/startWorker.ts:74` - SharedWorker module type options
- [ ] `packages/agent/src/agent.ts:256,315,338` - AI SDK provider metadata types, UIMessage stream
- [ ] `apps/web/src/ui/components/ai-elements/prompt-input.tsx:524` - Clipboard items iterator
- [ ] `apps/web/src/db.ts:2` - Vite WASM import query parameter
- [ ] `apps/server/src/server.ts:789,1846` - Fastify plugin and static file types

**Recommendation:** Fix the task-worker.ts issue (real bug). Others are workarounds for incomplete third-party types.

### 2.5 Empty Catch Blocks (Code Quality)

Found 18+ instances of empty catch blocks. Most are intentional for cleanup operations, but one was problematic:
- [x] `packages/agent/src/task-worker.ts:696` - Fixed. JSON parse error now logs warning: `console.warn("Failed to parse inbox item:", i.id, e)`

---

## Priority 3: User Experience Polish (Essential for v1)

These features significantly improve user confidence and experience.

### 3.1 Workflow Dry-Run Testing (idea: dry-run-testing.md) - COMPLETED

**Status:** Fully implemented with all features working:
- [x] "Test run" button in WorkflowDetailPage with amber styling
- [x] Server endpoint `POST /api/workflow/test-run` (returns HTTP 202, async execution)
- [x] `script_runs.type = 'test'` marker for test runs
- [x] Full sandbox execution with 300s timeout, 16MB memory
- [x] Test badge display in ScriptRunDetailPage
- [x] Concurrent test run prevention (409 if already running)
- [x] Cost tracking for test runs

### 3.2 Event Timeline Improvements - COMPLETED

#### 3.2a Highlight Significant Events - COMPLETED

**Status:** Fully implemented with:
- [x] `EventSignificance` type with 6 levels (normal, write, error, success, user, state)
- [x] All 32 event types configured with significance in EVENT_CONFIGS
- [x] `significanceStyles` in EventItem.tsx with Tailwind classes for each level
- [x] Dynamic significance for Gmail API calls (read vs write methods)
- [x] `getEventSignificance()` helper function for dynamic classification

#### 3.2b Collapse Low-Signal Events - COMPLETED

**Status:** Fully implemented with:
- [x] `eventSignal.ts` with SignalLevel type and `getEventSignalLevel()` function
- [x] LOW_SIGNAL_EVENTS list (web_fetch, web_search, get_weather, text_extract, etc.)
- [x] `CollapsedEventSummary.tsx` component showing count, types, and aggregate cost
- [x] `EventListWithCollapse.tsx` component with collapse/expand state
- [x] WorkflowEventGroup and TaskEventGroup using EventListWithCollapse
- [x] Auto-expand when hasError=true for debugging

### 3.3 Draft Management (idea: handle-abandoned-drafts.md) - v1 COMPLETE

**v1 approach (current behavior - no changes needed):**
- [x] Drafts remain in Draft status indefinitely (this is the current behavior)
- [ ] *(Optional post-v1)* Add gentle reminder notification after 3+ days inactive

**Future (post-v1):**
- Define abandoned draft detection (no activity for X days)
- Add archive status to hide from main list
- Add "stale drafts" banner on main page

### 3.4 In-App Bug Reporting (idea: in-app-bug-report.md) - COMPLETED

**Status:** Implemented with GitHub Issues integration:
- [x] Add "Report Issue" button to ErrorCard (all error types)
- [x] Add "Report Issue" button to EscalatedCard (for escalated failures)
- [x] Create `bugReport.ts` utility for generating GitHub issue URLs
- [x] Pre-filled context includes:
  - Error type, service, message
  - Workflow title and timestamp
  - Issue template with sections for reproduction steps
- [x] Opens GitHub Issues in new tab with pre-filled template

---

## Priority 4: Nice-to-Have for v1

Lower priority but would enhance the release.

### 4.1 Agent Status (idea: agent-status-from-active-runs.md)

**Completed (2026-01-23)**

The implementation includes:

1. [x] Added `getActiveTaskRuns()`, `countActiveTaskRuns()`, and `markOrphanedTaskRuns()` methods to TaskStore (`packages/db/src/task-store.ts`)
2. [x] Added `getActiveScriptRuns()`, `countActiveScriptRuns()`, and `markOrphanedScriptRuns()` methods to ScriptStore (`packages/db/src/script-store.ts`)
3. [x] Added orphaned run handling on server startup in `apps/server/src/server.ts` - marks all active runs as interrupted when server restarts
4. [x] Added `/api/agent/status` endpoint returning `{ activeTaskRuns, activeScriptRuns, isRunning }`
5. [x] Created `useAgentStatus` hook in `apps/web/src/hooks/useAgentStatus.ts` with adaptive polling (5s when active, 30s when idle)
6. [x] Created `AgentStatusBadge` component in `apps/web/src/components/AgentStatusBadge.tsx` showing status with animated pulse when running
7. [x] Added AgentStatusBadge to SharedHeader.tsx

### 4.2 Archive Old Drafts - COMPLETED

**Status:** Fully implemented. Archive functionality already exists in the codebase:
- [x] Archive button in WorkflowDetailPage (for draft status workflows) - `apps/web/src/components/WorkflowDetailPage.tsx:367-379`
- [x] Archived status badge - `apps/web/src/components/StatusBadge.tsx:16`
- [x] ArchivedPage for viewing archived workflows - `apps/web/src/components/ArchivedPage.tsx`
- [x] Route `/archived` defined in `apps/web/src/App.tsx:353`
- [x] MainPage filters out archived workflows and shows link to view them - `apps/web/src/components/MainPage.tsx:215-217,564-570`
- [x] Restore functionality returns workflow to draft status

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
