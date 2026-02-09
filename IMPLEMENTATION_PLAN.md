# Keep.AI v1 Implementation Plan

## Goal: Simple, Lovable, and Complete v1 Release

Keep.AI is a local personal automation product where AI creates and maintains automations. Users express intent, then fully delegate to the system. The execution model (exec-01 through exec-19) is fully implemented. This plan focuses on what remains to ship a polished, reliable v1.

**Current DB Version:** 45 | **Latest Tag:** v1.0.0-alpha.129

---

## Priority 1: Critical Bugs (Data Integrity & Core Functionality)

All Priority 1 bugs resolved.

- [x] **Fix script save atomicity** — `specs/fix-save-script-atomicity.md`
  - Wrapped `addScript` + `updateWorkflowFields` + maintenance clear in `db.tx()`
  - Added `db` and `producerScheduleStore` params to `makeSaveTool`

- [x] **Fix reconciliation transaction** — `specs/fix-reconciliation-transaction.md`
  - Wrapped workflow resume and handler_run resume in `this.api.db.db.tx()`

- [x] **Fix intent extraction validation** — `specs/fix-intent-extract-validation.md`
  - Added Zod `IntentExtractionSchema` to validate LLM response
  - Added optional chaining to all array accesses in `WorkflowIntentSection.tsx`

- [x] **Wire up producer schedule integration** — `specs/fix-producer-schedule-integration.md`
  - Save/fix tools now call `updateProducerSchedules()` after saving `handler_config`
  - Scheduler now queries `producerScheduleStore.getDueProducers()` for new-format workflows
  - Session orchestration only runs due producers for schedule triggers (falls back to all)
  - Scheduler no longer overwrites `next_run_timestamp` for new-format workflows

---

## Priority 2: High-Impact Bugs

All Priority 2 bugs resolved.

- [x] **Fix test run tracking leak** — `specs/fix-test-run-tracking-leak.md`
  - Wrapped WorkflowWorker construction in try-catch with Map cleanup
  - Added 10-minute safety timeout for hung test runs
  - Moved `generateId` import to module level

- [x] **Fix bug report GitHub repo** — `specs/fix-bug-report-github-repo.md`
  - Changed `GITHUB_REPO` from `"anthropics/keep-ai"` to `"nostrband/keep.ai"`

- [x] **Fix dropdown menu design tokens** — `specs/fix-dropdown-menu-design-tokens.md`
  - Restored `bg-popover`, `text-popover-foreground`, `bg-accent`, `text-accent-foreground`, `text-muted-foreground`, `bg-border`
  - Added `origin-[var(--radix-dropdown-menu-content-transform-origin)]`
  - Fixed tooltip.tsx to use design tokens

---

## Priority 3: UX Polish for v1 Release

All Priority 3 items resolved.

- [x] **Add React error boundaries**
  - Created `ErrorBoundary` class component in `apps/web/src/components/ErrorBoundary.tsx`
  - Wraps all routes in `App.tsx` — catches unhandled rendering errors
  - Shows user-friendly message with "Reload page" and "Go back" buttons
  - Error message displayed in pre block for debugging

- [x] **Clean up console.log statements**
  - Verified: zero `console.log` statements exist in web app
  - All remaining console calls are `console.error`, `console.warn`, or `console.debug` in appropriate error-handling contexts
  - No cleanup needed — codebase was already clean

- [x] **Improve reconciliation status visibility**
  - Added `usePendingReconciliation` hook querying indeterminate/needs_reconcile mutations
  - WorkflowDetailPage: amber alert banner showing "Verifying action completed" with mutation title and link to outputs
  - MainPage: bulk-fetches reconciliation state for all workflows, shows "Verifying action completed..." with amber styling
  - Workflow list items use amber left border and text for reconciliation (vs red for errors)

---

## Priority 4: Future Features (Post-v1)

## Architecture Summary

### Packages
| Package | Purpose | Status |
|---------|---------|--------|
| `packages/agent` | AI agent execution engine (79 files, ~8,100 LOC) | Complete |
| `packages/db` | Database layer, SQLite + CRSQLite (17 stores, 45 migrations) | Complete |
| `packages/connectors` | OAuth connections (Gmail, Drive, Sheets, Docs, Notion) | Complete |
| `packages/proto` | Shared types, Zod schemas, error classification | Complete |
| `packages/sync` | P2P sync via HTTP/SSE and Nostr (CRSQLite replication) | Complete |
| `packages/node` | Node.js standard lib (DB, transport, files, compression) | Complete |
| `packages/browser` | Browser standard lib (DB, workers, transport, compression) | Complete |
| `packages/tests` | Test suite (56 files, 1,209 tests, 1,154 passing) | Good coverage |

### Apps
| App | Purpose | Status |
|-----|---------|--------|
| `apps/web` | React frontend (3 modes: frontend, serverless, electron) | Complete |
| `apps/server` | Fastify backend (schedulers, sync, API, connectors) | Complete |
| `apps/electron` | Desktop app (tray, notifications, embedded server) | Complete |
| `apps/user-server` | User auth backend | Complete |

### Execution Model
- **Topics**: Durable event streams connecting producers to consumers
- **Producers**: Poll external systems, register inputs, publish events
- **Consumers**: 3-phase execution (prepare → mutate → next)
- **Handler State Machine**: Checkpoint-based crash recovery
- **Session Orchestration**: Groups handler runs, cost tracking
- **Reconciliation**: Verifies uncertain mutation outcomes
- **Maintainer**: Bounded auto-fix for logic errors

### Test Coverage
| Area | Status |
|------|--------|
| Database stores (16/16) | Excellent |
| Execution engine | Comprehensive (handler state machine, orchestration, phases) |
| Topics/events system | Good (46 tests) |
| AI tools | Good (11/40 tool files tested — script, file list/search/read/save, user-send, note, utility, save, fix, text generate/summarize/classify/extract, weather, web fetch/search) |
| Frontend components | None |
| Connectors package | None |
| Server routes | None |
| Electron app | None |

### Known FIXMEs in Codebase
1. `packages/sync/src/Peer.ts:788` — Transaction batching may split across boundaries
2. `packages/sync/src/nostr/stream/StreamWriter.ts:515` — Hardcoded chunk threshold needs bandwidth tuning
