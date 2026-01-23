# Keep.AI v1.0.0 Implementation Plan

## Status Summary (2026-01-23)

**✅ v1.0.0 Implementation COMPLETE** - All priority items finished. See [Completed Features](#completed-features-v100) section below for full details.

**Remaining Tasks:**
- Manual OAuth configuration (external, user-facing)
- Optional post-v1 improvements (see Priority 5)

## Remaining Work for v1.0.0

### Manual OAuth Configuration (External, User-Facing)

These are external configuration steps that users must complete in their OAuth provider consoles before they can authenticate. These cannot be automated and are documented for user reference.

#### Google Services OAuth Configuration
**User Action Required:** Register the following redirect URIs in Google Cloud Console:
- `http://127.0.0.1:4681/api/connectors/gdrive/callback`
- `http://localhost:4681/api/connectors/gdrive/callback`
- `http://127.0.0.1:4681/api/connectors/gsheets/callback`
- `http://localhost:4681/api/connectors/gsheets/callback`
- `http://127.0.0.1:4681/api/connectors/gdocs/callback`
- `http://localhost:4681/api/connectors/gdocs/callback`

(Gmail URIs from section 1.5 also required)

#### Notion OAuth Configuration
**User Action Required:** Register the following redirect URIs in Notion Developer Portal:
- `http://127.0.0.1:4681/api/connectors/notion/callback`
- `http://localhost:4681/api/connectors/notion/callback`

---

## Priority 2: Core Automation Reliability

### 2.2 Technical Debt (From FIXME/TODO Comments)

**Nice-to-have (post-v1):**
- [ ] `packages/sync/src/nostr/stream/StreamWriter.ts:515` - Find optimal chunk size for high bandwidth
  - Current: hardcoded limit of 10 pending chunks
  - Needs performance testing to find optimal value
- [ ] `packages/sync/src/Peer.ts:788` - Ensure tx delivery by organizing change batches properly
  - Related to CRSQLite change synchronization edge cases

### 2.3 Type Safety Cleanup

**Library type issues (post-v1):**
- `packages/browser/src/startWorker.ts:74` - SharedWorker module type options
- `packages/agent/src/agent.ts:256,315,338` - AI SDK provider metadata types, UIMessage stream
- `apps/web/src/ui/components/ai-elements/prompt-input.tsx:524` - Clipboard items iterator
- `apps/web/src/db.ts:2` - Vite WASM import query parameter
- `apps/server/src/server.ts:789,1846` - Fastify plugin and static file types

**Note:** These are workarounds for incomplete third-party library types and can be addressed post-v1.

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

## Completed Features (v1.0.0)

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
- Comprehensive unit tests (95%+ coverage for OAuth, 98%+ for credential store)

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
- Deprecated old Gmail-specific endpoints with console warnings

#### 1.6 Connections UI ✅
- ConnectionsSection component in Settings page
- Service groups with connection cards showing status badges
- Inline rename, reconnect, disconnect, and health check actions
- Connection label persistence to database
- Real-time updates via TanStack Query table invalidation

#### 1.7a Google Services ✅
- Service definitions for Gmail, Drive, Sheets, Docs
- Tools registered: GDrive, GSheets, GDocs (all with multi-account support)
- Shared OAuth client helper in `google-common.ts`
- Error classification via `classifyGoogleApiError()`

#### 1.7b Notion Connector ✅
- Notion service definition with Basic auth support
- Notion tool with all major API methods (databases, pages, blocks, search)
- Error classification via `classifyNotionError()`
- Workspace name display in UI via metadata field

</details>

### Priority 2: Core Automation Reliability ✅

**Summary:** Error handling, technical debt cleanup, and code quality improvements.

<details>
<summary>Implementation Details</summary>

#### 2.1 Error Handling Improvements ✅
- `classifyNotionError()` function for Notion API errors
- Verified all 18 external API tools use appropriate error classification
- Google APIs → `classifyGoogleApiError()`
- Notion API → `classifyNotionError()`
- Web APIs → `classifyHttpError()` + `classifyGenericError()`

#### 2.2 Technical Debt ✅
- Node.js EventSource polyfill implemented (`eventsource` v4.1.0)
- Works in both browser and Node.js environments

#### 2.4 Type Safety Cleanup ✅
- Fixed critical bug in `task-worker.ts` - now logs JSON parse errors properly
- Removed @ts-ignore with proper type annotations

#### 2.5 Empty Catch Blocks ✅
- Fixed problematic empty catch in `task-worker.ts` - now logs warnings

</details>

### Priority 3: User Experience Polish ✅

**Summary:** Workflow testing, event visualization, and bug reporting features.

<details>
<summary>Implementation Details</summary>

#### 3.1 Workflow Dry-Run Testing ✅
- "Test run" button in WorkflowDetailPage
- Server endpoint `POST /api/workflow/test-run` (async execution with 202 response)
- Test run marker (`script_runs.type = 'test'`) with badge display
- Concurrent test prevention and cost tracking

#### 3.2 Event Timeline Improvements ✅
- Event significance system with 6 levels (normal, write, error, success, user, state)
- Visual highlighting via Tailwind classes
- Collapsed low-signal events with expandable summaries
- Auto-expand on errors for debugging

#### 3.3 Draft Management ✅
- Drafts remain in draft status (current behavior, no changes needed)
- Post-v1: Optional reminder notifications

#### 3.4 In-App Bug Reporting ✅
- "Report Issue" buttons on ErrorCard and EscalatedCard
- Pre-filled GitHub issue templates with context
- Opens in new tab with error details, workflow info, and reproduction steps

</details>

### Priority 4: Nice-to-Have Features ✅

**Summary:** Agent status indicator and archive functionality.

<details>
<summary>Implementation Details</summary>

#### 4.1 Agent Status ✅
- Database methods for tracking active task/script runs
- `/api/agent/status` endpoint with run counts
- `useAgentStatus` hook with adaptive polling (5s active, 30s idle)
- AgentStatusBadge component in SharedHeader with animated pulse

#### 4.2 Archive Old Drafts ✅
- Archive button in WorkflowDetailPage for draft workflows
- ArchivedPage for viewing archived items
- Restore functionality to return workflows to draft status

</details>

### Additional Improvements (2026-01-23) ✅

**Summary:** Bug fixes, code quality refactors, and Spec 10 completion.

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
- Created `getWorkflowTitle()` utility (7 locations updated)
- Simplified disabled logic in chat components
- Fixed notification grammar and workflow name fallbacks
- Created `dbRun()` utility for sqlite3 Promise wrapping

#### Additional Fixes
- Fixed async patterns in server tests
- Added notification return value checking
- Fixed agent system prompts (removed obsolete field references)
- Improved error logging consistency
- Fixed unprofessional comments

#### Spec 10 Completion (TaskState Cleanup)
- Removed obsolete TaskState type/interface entirely
- Deprecated Tasks.* tools (moved to `packages/agent/src/tools/deprecated/`)
- Updated system prompts to remove task management references
- Introduced `TaskPatch` type for step output patches

</details>

---

## Architecture Constraints and Invariants

These design principles guide the v1.0.0 implementation:

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
