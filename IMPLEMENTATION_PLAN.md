# Keep.AI v1.0.0 Implementation Plan

## Status Summary (2026-01-26)

**✅ v1.0.0 Core Features COMPLETE** - All major functionality implemented. See [Completed Features](#completed-features-v100) section.

**✅ Critical Security Fixes COMPLETE** - All 8 security vulnerabilities in OAuth/connectors and server configuration have been addressed.

**Remaining Work:**
- Bug fixes (Priority 2) - 14 items
- Code quality improvements (Priority 3) - 10 items
- Nice-to-have optimizations (Priority 4) - 6 items
- Post-v1 features (Priority 5)
- Manual OAuth configuration (external, user-facing)

---

## Priority 1: Critical Security Fixes ✅

All security issues have been addressed for v1.0.0 release.

### 1.1 OAuth State Management Vulnerabilities
- [x] `specs/new/fix-oauth-state-management.md` - Unbounded state growth can exhaust memory
  - Added max pending states limit (100)
  - Added periodic cleanup timer
  - Reduced TTL from 10 to 5 minutes
  - Added redirect URI validation
  - **Location:** `packages/connectors/src/manager.ts`

### 1.2 OAuth State Race Condition
- [x] `specs/new/fix-oauth-state-race-condition.md` - Token replay attack vector
  - Made state consumption atomic (delete immediately after retrieval)
  - **Location:** `packages/connectors/src/manager.ts:126-150`

### 1.3 Token Refresh Race Condition
- [x] `specs/new/fix-token-refresh-race-condition.md` - Duplicate refresh requests
  - Added per-connection mutex for refresh requests using Map of Promises
  - **Location:** `packages/connectors/src/manager.ts`

### 1.4 Credential Store Path Traversal
- [x] `specs/new/fix-credential-store-path-traversal.md` - Path traversal vulnerability
  - Switched to base64url encoding with path validation
  - **Location:** `packages/connectors/src/store.ts`

### 1.5 Account ID Encoding Collision
- [x] `specs/new/fix-account-id-encoding.md` - Credential collision risk
  - Using collision-free base64url encoding
  - Added migration support for existing credentials
  - **Location:** `packages/connectors/src/store.ts`

### 1.6 Credential File Permissions
- [x] `specs/new/fix-credential-file-permissions.md` - Permissions not enforced
  - Implemented atomic write pattern (temp file + rename)
  - Added post-write permission verification with fs.stat()
  - Added startup audit of existing files
  - **Location:** `packages/connectors/src/store.ts`

### 1.7 OAuth Error Information Leakage
- [x] `specs/new/fix-oauth-error-information-leakage.md` - Exposes internal details
  - Added sanitized user-friendly error messages
  - Full details logged server-side only
  - **Location:** `packages/connectors/src/manager.ts`

### 1.8 API Keys Exposed via GET Endpoint
- [x] `GET /api/get_config` returns full Env object including API keys
  - Redacted sensitive values (`OPENROUTER_API_KEY`, `EXA_API_KEY`) in response
  - **Location:** `apps/server/src/server.ts:902-905`

---

## Priority 2: Bug Fixes

### 2.1 Database/Query Bugs
- [ ] `specs/new/fix-draft-activity-coalesce-bug.md` - SQL logic error (COALESCE vs MAX)
  - Drafts incorrectly marked as stale
  - **Location:** `packages/db/src/script-store.ts`

- [ ] `specs/new/audit-workflow-timestamp-updates.md` - Timestamp overwritten on update
  - Creation timestamp lost on workflow updates
  - **Location:** Multiple workflow update calls

- [ ] `specs/new/fix-tasks-deleted-type-mismatch.md` - Schema inconsistency
  - Test schema uses INTEGER, production uses BOOLEAN
  - **Location:** Test setup files

### 2.2 UI State Management Bugs
- [ ] `specs/new/fix-connections-section-timeout-leak.md` - Memory leak
  - 2-minute timeout not cleared on unmount
  - **Location:** `apps/web/src/components/ConnectionsSection.tsx`

- [ ] `specs/new/fix-connections-useeffect-dependency.md` - Unnecessary re-renders
  - Effect depends on entire object instead of specific property
  - **Location:** `apps/web/src/components/ConnectionsSection.tsx`

- [ ] `specs/new/fix-connections-rename-state-sync.md` - Stale state
  - newLabel doesn't sync with external updates
  - **Location:** `apps/web/src/components/ConnectionsSection.tsx`

- [ ] `specs/new/fix-disconnect-query-invalidation.md` - UI not updating
  - Disconnected connection remains visible until sync
  - **Location:** `apps/server/src/routes/connectors.ts`

- [ ] `specs/new/fix-archived-page-restore-feedback.md` - Missing feedback
  - No success/error messages on restore
  - **Location:** `apps/web/src/components/ArchivedPage.tsx`

### 2.3 Validation/Error Handling Bugs
- [ ] `specs/new/fix-cron-hourly-nan-validation.md` - NaN in hourly pattern
  - Shows "Every hour at :NaN"
  - **Location:** `apps/web/src/lib/formatCronSchedule.ts`

- [ ] `specs/new/fix-handle-check-response-validation.md` - JSON parse on error
  - Attempts JSON parsing without checking response.ok
  - **Location:** `apps/web/src/components/ConnectionsSection.tsx`

- [ ] `specs/new/fix-check-endpoint-status-codes.md` - Always returns 200
  - Returns 200 even on failure
  - **Location:** `apps/server/src/routes/connectors.ts`

- [ ] `specs/new/fix-console-log-quote-escaping.md` - Malformed output
  - Single quotes not escaped in console log
  - **Location:** `packages/agent/src/tools/console-log.ts`

### 2.4 Notification/Workflow Bugs
- [ ] `specs/new/fix-archived-workflow-notifications.md` - Notifications for archived
  - Users receive notifications about archived workflows
  - **Location:** Notification generation code

### 2.5 Server Infrastructure
- [ ] `specs/new/fix-server-shutdown-handling.md` - Resource leaks on shutdown
  - Schedulers, database, connections not properly cleaned up
  - **Location:** `apps/server/src/server.ts`

---

## Priority 3: Improvements

### 3.1 Code Quality
- [ ] `specs/new/consolidate-parse-message-content.md` - DRY violation
  - Function duplicated in 3 locations
  - Create shared utility in common package

- [ ] `specs/new/standardize-tool-patterns.md` - Inconsistent tool patterns
  - 5 tools use plain objects instead of AI SDK's tool()
  - Silently ignore ToolCallOptions
  - Standardize on AI SDK's tool() pattern

- [ ] `specs/new/refactor-gmail-use-google-common.md` - Duplicated logic
  - Gmail tool duplicates credential/OAuth client creation
  - Use shared google-common.ts utilities

### 3.2 Feature Enhancements
- [ ] `specs/new/expand-archive-to-paused-workflows.md` - Expand archive scope
  - Allow archiving paused workflows (not just drafts)
  - Add server-side validation

- [ ] `specs/new/add-archive-confirmation-dialog.md` - Prevent accidental archive
  - Add simple confirm() dialog before archiving

- [ ] `specs/new/smart-workflow-restore-status.md` - Smarter restore
  - Restore to "paused" if has scripts, "draft" if not

### 3.3 Event Tracking
- [ ] `specs/new/fix-gdrive-event-tracking.md` - Incomplete audit trail
  - Missing update/copy tracking in GDrive tool
  - Add update/copy to tracked methods

- [ ] `specs/new/fix-google-tools-event-tracking-pattern.md` - Fragile matching
  - Uses includes() for method matching which is fragile
  - Replace includes() with explicit method list

### 3.4 Security Hardening
- [ ] `specs/new/add-service-path-sanitization.md` - Defense in depth
  - Sanitize service IDs to alphanumeric only

- [ ] `specs/new/add-token-revocation-on-disconnect.md` - Token cleanup
  - Revoke OAuth token at provider on disconnect

---

## Priority 4: Nice-to-Have / Optimization

### 4.1 Performance
- [ ] `specs/new/optimize-has-script-subquery.md` - Query optimization
  - Replace COUNT subquery with EXISTS

### 4.2 Test Coverage
- [ ] `specs/new/add-transport-client-http-tests.md` - Missing tests
  - Add tests for SSE connection lifecycle, error recovery

### 4.3 Technical Debt (From FIXME Comments)
- [ ] `packages/sync/src/nostr/stream/StreamWriter.ts:515` - Find optimal chunk size
  - Hardcoded limit of 10 pending chunks needs tuning
- [ ] `packages/sync/src/Peer.ts:788` - Ensure tx delivery
  - CRSQLite change batch organization needs investigation

### 4.4 Type Safety
**Library type issues (post-v1):**
- `packages/browser/src/startWorker.ts:74` - SharedWorker module type options
- `packages/agent/src/agent.ts:256,315,338` - AI SDK provider metadata types
- `apps/web/src/ui/components/ai-elements/prompt-input.tsx:524` - Clipboard items
- `apps/web/src/db.ts:2` - Vite WASM import query parameter
- `apps/server/src/server.ts:789,1846` - Fastify plugin types

---

## Priority 5: Post-v1 Features

### 5.1 Monetization (idea: user-balance-and-payments.md)
- User balance display
- Stripe integration for top-up
- PAYMENT_REQUIRED error handling
- Usage tracking

### 5.2 UX Improvements
- Simplify question-answering workflow (idea: simplify-question-answering.md)
- Script diff view (idea: script-diff-view.md)
- Handle abandoned drafts (idea: handle-abandoned-drafts.md)

### 5.3 Infrastructure
- Push notifications (partially supported)
- Incremental OAuth scopes for Google services
- OS keystore integration for credential encryption

---

## Manual OAuth Configuration (External, User-Facing)

These are external configuration steps that users must complete in their OAuth provider consoles.

### Google Services OAuth Configuration
**User Action Required:** Register redirect URIs in Google Cloud Console:
- `http://127.0.0.1:4681/api/connectors/gmail/callback`
- `http://localhost:4681/api/connectors/gmail/callback`
- `http://127.0.0.1:4681/api/connectors/gdrive/callback`
- `http://localhost:4681/api/connectors/gdrive/callback`
- `http://127.0.0.1:4681/api/connectors/gsheets/callback`
- `http://localhost:4681/api/connectors/gsheets/callback`
- `http://127.0.0.1:4681/api/connectors/gdocs/callback`
- `http://localhost:4681/api/connectors/gdocs/callback`

### Notion OAuth Configuration
**User Action Required:** Register redirect URIs in Notion Developer Portal:
- `http://127.0.0.1:4681/api/connectors/notion/callback`
- `http://localhost:4681/api/connectors/notion/callback`

---

## Completed Features (v1.0.0)

### Security Fixes ✅

**Summary:** All 8 critical security vulnerabilities identified in OAuth/connectors and server configuration have been fixed.

<details>
<summary>Implementation Details</summary>

#### 1.1 OAuth State Management Vulnerabilities ✅
- Added max pending states limit (100 states)
- Added periodic cleanup timer for expired states
- Reduced TTL from 10 to 5 minutes
- Added redirect URI validation

#### 1.2 OAuth State Race Condition ✅
- Made state consumption atomic by deleting immediately after retrieval

#### 1.3 Token Refresh Race Condition ✅
- Added per-connection mutex using Map of Promises to prevent duplicate refresh requests

#### 1.4 Credential Store Path Traversal ✅
- Switched to base64url encoding for account IDs
- Added path validation to prevent traversal attacks

#### 1.5 Account ID Encoding Collision ✅
- Using collision-free base64url encoding
- Added migration support for existing credentials using old encoding

#### 1.6 Credential File Permissions ✅
- Implemented atomic write pattern (write to temp file, then rename)
- Added post-write permission verification with fs.stat()
- Added startup audit to fix permissions on existing files

#### 1.7 OAuth Error Information Leakage ✅
- Added sanitized user-friendly error messages for OAuth failures
- Full error details logged server-side only (not exposed to clients)

#### 1.8 API Keys Exposed via GET Endpoint ✅
- Redacted sensitive values (`OPENROUTER_API_KEY`, `EXA_API_KEY`) in `/api/get_config` response

</details>

### Priority 1: Connectors Framework ✅

**Summary:** Multi-account OAuth framework fully implemented with support for Gmail, Google Drive, Google Sheets, Google Docs, and Notion.

<details>
<summary>Implementation Details</summary>

#### 1.1 Build-Time Secrets ✅
- Secrets management via `secrets.build.json` with CI/CD fallback to env vars
- Template file and gitignore setup complete
- OAuth app credentials system in `packages/connectors/src/credentials.ts`

#### 1.2 Core Connectors Package ✅
- `packages/connectors` package with OAuth2 handler, credential store, connection manager
- Type-safe interfaces: ConnectionId, OAuthConfig, OAuthCredentials, Connection, ServiceDefinition
- File-based credential storage with 0o600 permissions

#### 1.3 Connection Manager + Database ✅
- ConnectionManager class with CSRF protection and automatic token refresh
- Database migration v33 with `connections` table (CRSQLite-enabled)
- ConnectionStore for metadata persistence
- Startup reconciliation between files and database

#### 1.4 Gmail Refactor ✅
- Gmail tool refactored to use ConnectionManager
- Multi-account support with required `account` parameter
- Migration from old `gmail.json` to new connector structure
- Backwards-compatible deprecation of old endpoints

#### 1.5 Server Endpoints ✅
- Generic `/api/connectors/*` endpoints for OAuth flows
- Auto-closing HTML callback pages with styled success/error messages
- Service listing, connection management, and health check endpoints

#### 1.6 Connections UI ✅
- ConnectionsSection component in Settings page
- Service groups with connection cards showing status badges
- Inline rename, reconnect, disconnect, and health check actions

#### 1.7a Google Services ✅
- Service definitions for Gmail, Drive, Sheets, Docs
- Tools registered: GDrive, GSheets, GDocs (all with multi-account support)
- Shared OAuth client helper in `google-common.ts`
- Error classification via `classifyGoogleApiError()`

#### 1.7b Notion Connector ✅
- Notion service definition with Basic auth support
- Notion tool with all major API methods (databases, pages, blocks, search)
- Error classification via `classifyNotionError()`

</details>

### Priority 2: Core Automation Reliability ✅

**Summary:** Error handling, technical debt cleanup, and code quality improvements.

<details>
<summary>Implementation Details</summary>

#### 2.1 Error Handling Improvements ✅
- Error classification for all 18+ external API tools
- Google APIs → `classifyGoogleApiError()`
- Notion API → `classifyNotionError()`
- Web APIs → `classifyHttpError()` + `classifyGenericError()`

#### 2.2 Technical Debt ✅
- Node.js EventSource polyfill implemented
- Empty catch blocks fixed with proper logging

</details>

### Priority 3: User Experience Polish ✅

**Summary:** Workflow testing, event visualization, and bug reporting features.

<details>
<summary>Implementation Details</summary>

#### 3.1 Workflow Dry-Run Testing ✅
- "Test run" button in WorkflowDetailPage
- Server endpoint `POST /api/workflow/test-run`
- Test run marker with badge display

#### 3.2 Event Timeline Improvements ✅
- Event significance system with 6 levels
- Visual highlighting via Tailwind classes
- Collapsed low-signal events with expandable summaries
- Auto-expand on errors for debugging

#### 3.3 In-App Bug Reporting ✅
- "Report Issue" buttons on ErrorCard and EscalatedCard
- Pre-filled GitHub issue templates

</details>

### Priority 4: Nice-to-Have Features ✅

**Summary:** Agent status indicator and archive functionality.

<details>
<summary>Implementation Details</summary>

#### 4.1 Agent Status ✅
- Database methods for tracking active runs
- `/api/agent/status` endpoint
- `useAgentStatus` hook with adaptive polling
- AgentStatusBadge component with animated pulse

#### 4.2 Archive Old Drafts ✅
- Archive button in WorkflowDetailPage
- ArchivedPage for viewing archived items
- Restore functionality

</details>

### Additional Improvements ✅

<details>
<summary>Implementation Details</summary>

#### Bug Fixes
- Task creation error toast notifications
- File upload failure warnings
- HTTP status validation in useNeedAuth
- Database transaction for script activation (TOCTOU fix)

#### Code Quality Refactors
- Moved `formatCronSchedule` to lib with error handling
- Centralized `--header-height` CSS variable
- Created `getWorkflowTitle()` utility
- Created `dbRun()` utility for sqlite3 Promise wrapping

#### Spec 10 Completion (TaskState Cleanup)
- Removed obsolete TaskState type/interface
- Deprecated Tasks.* tools
- Updated system prompts

</details>

---

## Architecture Constraints and Invariants

### OAuth Security
- Desktop app client secrets are public - security relies on redirect URI validation
- Always use 127.0.0.1 for local OAuth (more reliable than localhost)
- Register both 127.0.0.1 and localhost variants in OAuth provider consoles

### Multi-Account Design
- Tools MUST require explicit `accountId` parameter
- No "default account" fallback - prevents accidental account mixing
- Error messages list available accounts to help agent self-correct

### Data Storage Split
- **Files**: OAuth tokens (sensitive) - `{userPath}/connectors/{service}/{accountId}.json`
- **Database**: Connection metadata (non-sensitive) - syncs to all clients via CRSQLite

### Package Dependencies
- `@app/connectors` must NOT import `@app/db` directly
- Database interface is injected via ConnectionManager constructor

### UI Reactivity
- Connection changes appear via database sync (TanStack Query with table invalidation)
- Pattern: `useQuery({ ..., meta: { tables: ["connections"] } })`
- OAuth callback returns HTML that auto-closes (no postMessage needed)

---

## Test Coverage Status

**Current Coverage:**
- `packages/tests`: 18 test files (store tests, sync tests, sandbox tests)
- `apps/user-server`: 5 test files (server, auth, database tests)

**Missing Test Coverage:**
- `@app/agent` - No tests (critical module)
- `@app/connectors` - No tests
- `@app/web` - No tests
- `@app/server` - No tests
- `@app/electron` - No tests

**Skipped Tests (45+):**
- `nostr-transport-sync.test.ts` - Requires WebSocket environment
- `exec-many-args-browser.test.ts` - Requires browser environment
- `crsqlite-peer-new.test.ts` - CRSqlite peer sync tests
- Various other tests skipped due to environment requirements

---

## Code Quality Issues Found

### apps/web
- `ConsolePage.tsx:66` - SQL validation intentionally disabled (`if (false &&`)
- Multiple `any` type usages in WorkflowDetailPage, TaskEventGroup
- Empty catch blocks in worker-event-router.ts, service-worker.ts

### apps/server
- Deprecated Gmail endpoints still functional (lines 1206-1636)
- Stream errors not handled in file download/upload
- Fire-and-forget async operations without tracking

### apps/electron
- `index.html` references undefined `electronAPI.sendMessage()`
- Extensive `any` type usage in main.ts
- Path traversal vulnerability in file handler (line 470-471)
