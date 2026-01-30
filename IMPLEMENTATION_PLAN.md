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
  - Status: **NOT IMPLEMENTED** (major feature - no code exists)
  - Components needed:
    - [ ] `Items.withItem(id, title, handler)` API in sandbox
    - [ ] Items database table with states (processing, done, failed, skipped)
    - [ ] `Items.list()` tool for introspection
    - [ ] Sandbox callback support (`wrapGuestCallback`, `awaitGuestPromise`)
    - [ ] Tool wrapper refactor with `isReadOnly` metadata
    - [ ] Mutation restrictions (writes only inside `withItem()`)

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

- [ ] **Add tests for POST endpoint failures** - [specs/new/transport-post-failure-tests.md](specs/new/transport-post-failure-tests.md)
  - File: `packages/tests/src/transport-http.test.ts`
  - Issue: Missing test coverage for POST endpoint error responses (500, timeout) in TransportClientHttp
  - Fix: Add tests with mock server returning error responses; verify graceful error handling
  - Status: **NOT FIXED** - no tests for /sync and /data POST endpoint failures

- [ ] **Add client credentials to token revocation** - [specs/new/token-revocation-client-credentials.md](specs/new/token-revocation-client-credentials.md)
  - File: `packages/auth/src/oauth.ts`
  - Issue: Token revocation request only includes access token, missing client_id and client_secret
  - Fix: Add client credentials to revocation request body, matching token exchange pattern
  - Status: **NOT FIXED** - revocation request missing client credentials

- [ ] **Clarify token revocation status return values** - [specs/new/revocation-status-clarity.md](specs/new/revocation-status-clarity.md)
  - Files: `packages/auth/src/oauth.ts`, `packages/auth/src/manager.ts`
  - Issue: Returns `true` when revoke URL not configured; logs misleadingly say "Token revoked"
  - Fix: Change return type to include reason ('revoked', 'not_supported', 'failed'); update logging
  - Status: **NOT FIXED** - boolean return makes logs misleading

### P3 - Low (Technical Debt & Cleanup)

- [ ] **Remove prototyping migration code**
  - File: `packages/db/src/database.ts:163-165`
  - Issue: Temporary prototyping code for migration should be removed before v1
  - Fix: Remove the marked lines after confirming no longer needed
  - Status: **NOT FIXED** - code still present

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
| P1 High | 10 | 9 complete |
| P2 Medium | 13 | 8 complete (1 documented) |
| P3 Low | 2 | 0 complete |
| **Total** | **31** | **23 complete** |

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
