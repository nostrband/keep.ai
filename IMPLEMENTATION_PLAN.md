# Keep.AI Implementation Plan

Last updated: 2026-01-30 (verified against source code)

This plan tracks items to be implemented for a simple, lovable, and complete v1 Keep.AI release.

---

## Priority Legend
- **P0 (Critical)**: Security issues, data integrity bugs, race conditions
- **P1 (High)**: Core feature gaps, significant UX issues
- **P2 (Medium)**: Code quality, test coverage, maintainability
- **P3 (Low)**: Minor improvements, cleanup

---

## Implementation Items

### P0 - Critical (Security & Data Integrity)

- [x] **Fix secret key file permissions** - [specs/fix-secret-key-file-permissions.md](specs/fix-secret-key-file-permissions.md)
  - Files: `packages/node/src/getDBPath.ts:157`, `apps/cli/src/commands/init.ts:93`
  - Issue: `users.json` created with 0644 (world-readable), contains secret keys
  - Fix: Add `{ mode: 0o600 }` to `fs.writeFileSync()` calls
  - Status: **FIXED** - both locations now use `writeFileSync(..., { mode: 0o600 })`

- [x] **Fix incrementMaintenanceFixCount atomicity** - [specs/fix-increment-maintenance-fix-count-atomicity.md](specs/fix-increment-maintenance-fix-count-atomicity.md)
  - File: `packages/db/src/script-store.ts:752-764`
  - Issue: TOCTOU race between UPDATE and SELECT
  - Fix: Use `UPDATE ... RETURNING maintenance_fix_count`
  - Status: **FIXED** - now uses `UPDATE ... RETURNING` pattern

- [x] **Fix getDBPath race condition** - [specs/fix-getdbpath-race-condition.md](specs/fix-getdbpath-race-condition.md)
  - File: `packages/node/src/getDBPath.ts:63-65, 107-109, 126-128, 152-154` and `apps/cli/src/commands/init.ts:70-72`
  - Issue: Redundant `existsSync` before `mkdirSync` creates TOCTOU race (5 locations)
  - Fix: Remove checks, rely on `{ recursive: true }`
  - Status: **FIXED** - removed redundant `if (!fs.existsSync(...))` checks at all 5 locations

- [x] **Fail fast on missing scriptRunId** - [specs/fail-fast-missing-scriptrunid.md](specs/fail-fast-missing-scriptrunid.md)
  - File: `packages/agent/src/task-worker.ts:539-551`
  - Issue: Returns fallback context when scriptRunId missing, may fix wrong script
  - Fix: Return `undefined` instead of fallback context
  - Status: **FIXED** - now returns `undefined` instead of fallback context

- [x] **Fix Electron symlink vulnerability** - [specs/new/electron-symlink-vulnerability-fix.md](specs/new/electron-symlink-vulnerability-fix.md)
  - File: Electron file protocol handler in `apps/electron`
  - Issue: Uses `path.resolve()` which doesn't resolve symlinks, allowing bypass if attacker can create symlink in `public/`
  - Fix: Replace `path.resolve()` with `fs.realpathSync()` to resolve symbolic links before validation
  - Status: **FIXED** - now uses `fs.realpathSync()` instead of `path.resolve()` to resolve both symlinks and path syntax

- [x] **Fix Electron Windows case sensitivity** - [specs/new/electron-windows-case-sensitivity-fix.md](specs/new/electron-windows-case-sensitivity-fix.md)
  - File: Electron file protocol handler in `apps/electron`
  - Issue: Case-sensitive path comparison on case-insensitive Windows filesystem allows access to files outside intended directory
  - Fix: Normalize paths to lowercase on Windows before comparison
  - Status: **FIXED** - paths are now normalized to lowercase on Windows before comparison

### P1 - High (Core Features & Significant Fixes)

- [ ] **Implement logical items infrastructure** - [specs/logical-items.md](specs/logical-items.md)
  - Status: **PARTIALLY IMPLEMENTED** (core infrastructure complete, integration pending)
  - Implemented:
    - [x] Items database table (v35 migration) with states (processing, done, failed, skipped)
    - [x] ItemStore for database operations
    - [x] `Items.withItem(id, title, handler)` API in SandboxAPI
    - [x] `Items.list` tool for introspection
    - [x] Sandbox callback support (`wrapGuestCallback`, `awaitGuestPromise`)
  - Remaining (not blocking):
    - [ ] Tool interface refactor (migrate existing tools to new Tool interface with `isReadOnly` metadata)
    - [ ] Mutation enforcement (currently withItem works but doesn't enforce mutation restrictions)
    - [ ] Prompting changes (planner/maintainer prompts need updating)
    - [ ] Tests for the new functionality

- [x] **Fix tool always saves, check active for race** - [specs/fix-tool-always-save-check-active.md](specs/fix-tool-always-save-check-active.md)
  - File: `packages/agent/src/ai-tools/fix.ts`
  - Issue: Fixes discarded on race instead of saved; uses majorVersion not scriptId
  - Fix: Always save fixes; compare `active_script_id`; replace `expectedMajorVersion` with `expectedScriptId`
  - Status: **FIXED** - returns `activated: false` but still saves fix; compares `active_script_id` to `expectedScriptId`

- [x] **Fix draft activity double-counting** - [specs/fix-draft-activity-double-counting.md](specs/fix-draft-activity-double-counting.md)
  - File: `packages/db/src/script-store.ts:1005-1014`
  - Issue: Drafts 30+ days counted in both archivable AND abandoned
  - Fix: Make categories mutually exclusive (remove line 1009 `abandonedDrafts++`)
  - Status: **FIXED** - categories now mutually exclusive; tests updated to match

- [x] **Include full changelog in maintainer context** - [specs/include-full-changelog-in-maintainer-context.md](specs/include-full-changelog-in-maintainer-context.md)
  - File: `packages/agent/src/task-worker.ts:582`
  - Issue: Changelog limited to 5 entries, maintainer may repeat failed approaches
  - Fix: Remove `.slice(0, 5)` to include all entries for major version
  - Status: **FIXED** - `.slice(0, 5)` removed; all entries for major version now included

- [x] **Add fix tool onCalled callback** - [specs/fix-tool-called-callback.md](specs/fix-tool-called-callback.md)
  - Files: `packages/agent/src/ai-tools/fix.ts`, `packages/agent/src/task-worker.ts`, `packages/agent/src/agent.ts`
  - Issue: Uses fragile `part.type === "tool-fix"` SDK inspection
  - Fix: Add `onCalled` callback parameter like other tools (ask, finish)
  - Status: **FIXED** - `makeFixTool` has `onCalled` callback; Agent tracks `fixCalled` flag; removed `checkIfFixToolCalled()`

- [x] **Fix MIME detection fallback** - [specs/fix-mime-detection-fallback.md](specs/fix-mime-detection-fallback.md)
  - File: `packages/node/src/fileUtils.ts:118`
  - Issue: Condition `!mediaType` never true; fallback unreachable
  - Fix: Change to `mediaType === 'application/octet-stream'`
  - Status: **FIXED** - condition changed to check for generic fallback; filename detection now works

- [x] **Truncate maintainer logs by chars** - [specs/truncate-maintainer-logs-by-chars.md](specs/truncate-maintainer-logs-by-chars.md)
  - File: `packages/agent/src/task-worker.ts:588-593`
  - Issue: Line-based truncation (50 lines) unpredictable for long lines
  - Fix: Use `.slice(-5000)` for last 5000 chars, add `[truncated]` prefix
  - Status: **FIXED** - now uses `.slice(-5000)` with `[truncated]` prefix

- [x] **Validate workflow_id early for maintainer tasks** - [specs/new/maintainer-workflow-id-validation.md](specs/new/maintainer-workflow-id-validation.md)
  - File: `packages/agent/src/task-worker.ts` (in `executeTask()`)
  - Issue: Missing `workflow_id` causes late failure with confusing "Maintainer task requires maintainerContext" error
  - Fix: Add early validation after type check; fail fast with clear error message
  - Status: **FIXED** - early validation added at line 118, fails with clear "Maintainer task missing workflow_id" error

- [x] **Add null check in ArchivedPage restore logic** - [specs/new/archived-page-null-check.md](specs/new/archived-page-null-check.md)
  - File: `apps/web/src/components/ArchivedPage.tsx`
  - Issue: `workflows.find()` may return undefined; optional chaining silently defaults to "draft" with no error
  - Fix: Add explicit null check; show error to user and abort restore if workflow not found
  - Status: **FIXED** - added explicit null check in handleRestore for workflow.find() result; user sees error message "Workflow not found. Try refreshing the page." and operation aborts; WorkflowDetailPage already had a null guard so no changes needed there

- [x] **Replace window.confirm() with modal dialog** - [specs/new/replace-window-confirm-modal.md](specs/new/replace-window-confirm-modal.md)
  - File: `apps/web/src/components/WorkflowDetailPage.tsx`
  - Issue: Native `window.confirm()` blocks event loop, can't match design system, has accessibility issues
  - Fix: Replace with purpose-built confirmation modal using app's existing UI components
  - Status: **FIXED** - Replaced window.confirm() with a custom modal dialog matching the app's design system; modal is non-blocking, accessible, and consistent with app UX; uses state management (showArchiveConfirm) instead of blocking confirm(); added backdrop click to dismiss

- [x] **Fix missing awaits in server shutdown** - [specs/new/fix-shutdown-missing-awaits.md](specs/new/fix-shutdown-missing-awaits.md)
  - File: `apps/server/src/server.ts` (in `close()`)
  - Issue: `nostr.stop()` and `peer.stop()` called without `await`, causing race conditions during shutdown
  - Fix: Add `await` to both async stop() calls
  - Status: **FIXED** - both calls now properly awaited

- [x] **Scheduler graceful shutdown** - [specs/new/scheduler-graceful-shutdown.md](specs/new/scheduler-graceful-shutdown.md)
  - Files: `packages/agent/src/task-scheduler.ts`, `packages/agent/src/workflow-scheduler.ts`
  - Issue: `close()` methods don't wait for in-progress `checkWork()` to complete
  - Fix: Add polling loop to wait for `isRunning` to become false with 30s timeout
  - Status: **FIXED** - both schedulers now wait for in-progress work with timeout and warning

### P2 - Medium (Code Quality & Tests)

- [x] **Fix compression error message** - [specs/fix-compression-error-message.md](specs/fix-compression-error-message.md)
  - Files: `packages/node/src/compression.ts:274,436`, `packages/browser/src/compression.ts:337,503`
  - Issue: Message says "binary mode" when actually in string mode
  - Fix: Change to "expected string input in string mode, got Uint8Array"
  - Status: **FIXED** - all 4 locations now say "Uint8Array input in string mode"

- [x] **Fix maxResultSizeSafe return value** - [specs/fix-maxresultsizesafe-return-value.md](specs/fix-maxresultsizesafe-return-value.md)
  - Files: 4 implementations in `packages/node/src/compression.ts` and `packages/browser/src/compression.ts`
  - Issue: Returns `this.maxResultSize` instead of `undefined` when no limit
  - Fix: Change to `return undefined` in all 4 implementations
  - Status: **FIXED** - all 4 implementations now return `undefined` with explicit type annotation

- [x] **Export MAX_FIX_ATTEMPTS constant** - [specs/export-max-fix-attempts-constant.md](specs/export-max-fix-attempts-constant.md)
  - Files: `packages/agent/src/workflow-worker.ts:25`, `packages/tests/src/maintainer-integration.test.ts`
  - Issue: Constant defined but not exported; tests hardcode "3"
  - Fix: Add `export` to constant; import in tests
  - Status: **FIXED** - constant exported from workflow-worker and imported in tests

- [x] **Fix maintainer tasks type safety** - [specs/fix-maintainer-tasks-type-safety.md](specs/fix-maintainer-tasks-type-safety.md)
  - File: `apps/web/src/components/WorkflowDetailPage.tsx:497`
  - Issue: Uses `any` type in `maintainerTasks.map((task: any) => ...)`
  - Fix: Import `Task` from `@app/db`, use proper type
  - Status: **FIXED** - imported `Task` type, changed `(task: any)` to `(task: Task)`

- [x] **Extract draft activity summary default** - [specs/extract-draft-activity-summary-default.md](specs/extract-draft-activity-summary-default.md)
  - File: `apps/web/src/hooks/dbScriptReads.ts:293-299,304-310`
  - Issue: Duplicated fallback object in two locations
  - Fix: Extract to `DEFAULT_DRAFT_ACTIVITY_SUMMARY` constant
  - Status: **FIXED** - extracted to shared constant used by both locations

- [x] **Improve workflows filter param handling** - [specs/improve-workflows-filter-param-handling.md](specs/improve-workflows-filter-param-handling.md)
  - File: `apps/web/src/components/WorkflowsPage.tsx:13-21`
  - Issue: No case normalization, no validation, no feedback for invalid filters
  - Fix: Add `.toLowerCase()`, whitelist validation, user feedback
  - Status: **FIXED** - added `normalizeFilter()` with case normalization and whitelist validation

- [x] **Add escalateToUser integration tests** - [specs/add-escalatetouser-integration-tests.md](specs/add-escalatetouser-integration-tests.md)
  - File: `packages/tests/src/maintainer-integration.test.ts`
  - Issue: Tests manually implement escalation logic instead of calling actual method
  - Fix: Call actual `escalateToUser()`, test message sending, error handling, logging
  - Status: **FIXED** - `escalateToUser` function extracted to exported function for testability; tests now call actual `escalateToUser` from `@app/agent`; tests verify workflow status update, notification creation, and message sending

- [ ] **Fix skipped compression tests** - [specs/fix-skipped-compression-tests.md](specs/fix-skipped-compression-tests.md)
  - File: `packages/tests/src/compression.test.ts:523,540`
  - Issue: Two tests skipped due to zlib timing sensitivity
  - Fix: Find alternative testing approach (sync validation, timeout, or mock)
  - Status: **DOCUMENTED** - tests intentionally skipped with detailed comments explaining zlib stream timing issues

- [x] **Refactor task scheduler priority tests** - [specs/refactor-task-scheduler-priority-tests.md](specs/refactor-task-scheduler-priority-tests.md)
  - Files: `packages/agent/src/task-scheduler.ts:216-241`, `packages/tests/src/task-scheduler-priority.test.ts:110-133`
  - Issue: Test duplicates production logic instead of testing actual code
  - Fix: Export priority selection as testable function; remove duplicate helper
  - Status: **FIXED** - priority selection logic extracted to exported `selectTaskByPriority` function; tests now import and use the real function

- [x] **Add tests for POST endpoint failures** - [specs/new/transport-post-failure-tests.md](specs/new/transport-post-failure-tests.md)
  - File: `packages/tests/src/transport-client-http.test.ts`
  - Issue: Missing test coverage for POST endpoint error responses (500, timeout) in TransportClientHttp
  - Fix: Add tests with mock server returning error responses; verify graceful error handling
  - Status: **FIXED** - added tests for 500, 503, and 400 responses from /sync and /data endpoints

- [x] **Fix invalid nested aggregation in draft activity query** - [specs/new/fix-draft-activity-sql.md](specs/new/fix-draft-activity-sql.md)
  - File: `packages/db/src/script-store.ts:878-882,959-963`
  - Issue: Invalid nested `MAX(COALESCE(MAX(...), ...))` SQL syntax
  - Fix: Replace with proper CASE expression to find maximum timestamp
  - Status: **FIXED** - converted to CASE expression that correctly compares timestamps

- [x] **Add client credentials to token revocation** - [specs/new/token-revocation-client-credentials.md](specs/new/token-revocation-client-credentials.md)
  - File: `packages/auth/src/oauth.ts`
  - Issue: Token revocation request only includes access token, missing client_id and client_secret
  - Fix: Add client credentials to revocation request body, matching token exchange pattern
  - Status: **FIXED** - added client_id and client_secret to revocation request body; uses same pattern as exchangeCode (Basic auth header or body params); consistent authentication across all OAuth operations

- [x] **Clarify token revocation status return values** - [specs/new/revocation-status-clarity.md](specs/new/revocation-status-clarity.md)
  - Files: `packages/auth/src/oauth.ts`, `packages/auth/src/manager.ts`
  - Issue: Returns `true` when revoke URL not configured; logs misleadingly say "Token revoked"
  - Fix: Change return type to include reason ('revoked', 'not_supported', 'failed'); update logging
  - Status: **FIXED** - changed return type from boolean to RevokeResult with reason; reasons: 'revoked', 'not_supported', or 'failed'; updated manager.ts to log appropriately based on reason; exported RevokeResult type from @app/connectors

- [x] **Migrate schedule tool to updateWorkflowFields** - [specs/new/migrate-schedule-to-updateWorkflowFields.md](specs/new/migrate-schedule-to-updateWorkflowFields.md)
  - File: `packages/agent/src/ai-tools/schedule.ts`
  - Issue: Uses spread pattern with `updateWorkflow` instead of atomic `updateWorkflowFields`
  - Fix: Replace spread pattern with direct `updateWorkflowFields()` call
  - Status: **FIXED** - now uses `updateWorkflowFields(workflow.id, { cron, next_run_timestamp })`

- [x] **Fix console-log backslash escaping** - [specs/new/console-log-backslash-escaping.md](specs/new/console-log-backslash-escaping.md)
  - File: `packages/agent/src/tools/console-log.ts`
  - Issue: Only single quotes escaped, backslashes not - creates ambiguity for `test\'`
  - Fix: Escape backslashes first (`\\`), then quotes (`\'`)
  - Status: **FIXED** - backslashes now escaped before quotes to prevent ambiguity

- [x] **Crop before escaping in console-log** - [specs/new/console-log-crop-before-escape.md](specs/new/console-log-crop-before-escape.md)
  - File: `packages/agent/src/tools/console-log.ts`
  - Issue: 1000 char limit applied after escaping; may cut escape sequences and cause unexpected truncation
  - Fix: Crop input before escaping
  - Status: **FIXED** - input now cropped before escaping for predictable 1000 char limit

- [x] **Fix overly broad "token" error classification** - [specs/new/connectors-error-classification-token.md](specs/new/connectors-error-classification-token.md)
  - File: `apps/server/src/routes/connectors.ts:209`
  - Issue: `includes("token")` too broad - incorrectly classifies "token bucket rate limit" as 401
  - Fix: Use specific patterns: "token expired", "invalid token", "token revoked", "access token"
  - Status: **FIXED** - now uses specific token patterns to avoid false positives

- [x] **Fix overly broad "service" error classification** - [specs/new/connectors-error-classification-service.md](specs/new/connectors-error-classification-service.md)
  - File: `apps/server/src/routes/connectors.ts:219`
  - Issue: `includes("service")` too broad - incorrectly classifies many errors as 503
  - Fix: Use specific patterns: "service unavailable", "service error", "service down", "503"
  - Status: **FIXED** - now uses specific service patterns to avoid false positives

- [x] **Extract disconnect mutation hook** - [specs/new/extract-disconnect-mutation-hook.md](specs/new/extract-disconnect-mutation-hook.md)
  - Files: `apps/web/src/hooks/dbWrites.ts`, `apps/web/src/components/ConnectionsSection.tsx`
  - Issue: Disconnect logic inline in component instead of mutation hook pattern
  - Fix: Create `useDisconnectConnection` hook; refactor component to use it
  - Status: **FIXED** - created `useDisconnectConnection` hook; component refactored to use it

- [x] **Add onError callback to ArchivedPage** - [specs/new/archived-page-onerror-callback.md](specs/new/archived-page-onerror-callback.md)
  - File: `apps/web/src/components/ArchivedPage.tsx`
  - Status: **FIXED** - onError callback already present at lines 40-43

### P3 - Low (Technical Debt & Cleanup)

- [x] **Remove prototyping migration code**
  - File: `packages/db/src/database.ts:163-191`
  - Issue: Temporary prototyping code for v7 migration should be removed before v1
  - Fix: Remove the migration v7 data copy code (crsql_changes to crsql_change_history)
  - Status: **FIXED** - removed temporary v7 migration code that copied crsql_changes data

- [x] **Standardize React Query mutation error handling** - [specs/new/standardize-mutation-error-handling.md](specs/new/standardize-mutation-error-handling.md)
  - Files: `apps/web/src/components/ArchivedPage.tsx`, `apps/web/src/components/WorkflowDetailPage.tsx`
  - Issue: Inconsistent patterns - ArchivedPage uses `mutateAsync` with try/catch, WorkflowDetailPage uses `mutate` with callbacks
  - Fix: Standardize on callback-based `mutate` pattern across codebase
  - Status: **FIXED** - ArchivedPage now uses callback-based `mutate` pattern with onSuccess/onError

- [x] **Remove files.list from GDrive TRACKED_METHODS** - [specs/new/remove-files-list-from-tracked.md](specs/new/remove-files-list-from-tracked.md)
  - File: `packages/agent/src/tools/gdrive.ts`
  - Issue: Read-only `files.list` operation tracked alongside write operations, causing event noise
  - Fix: Remove `files.list` from TRACKED_METHODS Set
  - Status: **FIXED** - files.list removed from TRACKED_METHODS; only write operations are now tracked

- [x] **Fix cron format range validation** - [specs/new/cron-format-range-validation.md](specs/new/cron-format-range-validation.md)
  - File: `apps/web/src/lib/formatCronSchedule.ts`
  - Issue: Out-of-range values display impossible times (":75", "99:00")
  - Fix: Add range validation (minutes 0-59, hours 0-23, etc.), fall back to raw cron
  - Status: **FIXED** - added range validation for all numeric fields, falls back to raw cron if out of range

- [x] **Fix cron format "every minute" check** - [specs/new/cron-format-every-minute-check.md](specs/new/cron-format-every-minute-check.md)
  - File: `apps/web/src/lib/formatCronSchedule.ts`
  - Issue: Check only verifies minute/hour wildcards; "* * 1 * *" incorrectly returns "Every minute"
  - Fix: Verify all five fields are wildcards before returning "Every minute"
  - Status: **FIXED** - now checks all five cron fields before returning "Every minute"

- [ ] **Enable skipped test suites**
  - Files:
    - `packages/tests/src/exec-many-args-browser.test.ts` - entire suite skipped (requires IndexedDB)
    - `packages/tests/src/nostr-transport.test.ts` - 2 tests skipped (requires WebSocket)
    - `packages/tests/src/crsqlite-peer-new.test.ts` - entire sync suite skipped
    - `packages/tests/src/file-transfer.test.ts` - real encryption test skipped
    - `packages/tests/src/nostr-transport-sync.test.ts` - entire sync suite skipped
  - Issue: Multiple test suites skipped due to environment requirements (IndexedDB, WebSocket)
  - Fix: Add browser test runner support or mock implementations
  - Status: **NOT FIXED** - suites remain skipped

---

## Summary

| Priority | Count | Status |
|----------|-------|--------|
| P0 Critical | 6 | 6 complete |
| P1 High | 12 | 11 complete + 1 partial |
| P2 Medium | 21 | 19 complete (1 documented) |
| P3 Low | 6 | 5 complete |
| **Total** | **45** | **41 complete + 1 partial** |

---

## Notes

- All items verified against source code on 2026-01-30
- The `logical-items.md` spec is a major feature requiring multiple phases (no code exists)
- P0 items should be addressed first as they involve security and data integrity
- Many P2 items are quick fixes that improve code quality
- `fix-skipped-compression-tests` has documented reasons for skipped tests (zlib timing sensitivity); remains as technical debt
- P3 items are lower priority technical debt that can be addressed post-v1
- FIXMEs exist in `packages/sync` (tx delivery reliability) and `StreamWriter` (bandwidth tuning) - not tracked in this plan
- Various hardcoded values exist (retry timeouts, batch sizes, connection delays) - not tracked unless causing issues

---

## Verification Notes

Each item above has been verified by reading the actual source code at the specified locations. The "Status" field reflects the current implementation state as of the verification date.
