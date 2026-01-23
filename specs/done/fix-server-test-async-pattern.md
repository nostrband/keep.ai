# Spec: Fix server.test.ts Async Database Pattern

## Problem
The `server.test.ts` file has 3 instances of incorrectly awaiting sqlite3's callback-based `db.run()` method at lines 96, 128, and 168. This is the same broken pattern that was fixed in `database.test.ts` and `integration.test.ts`, but `server.test.ts` was missed during that fix.

The pattern `await (database as any).db.run(...)` doesn't actually wait for the UPDATE to complete because `db.run()` is callback-based, not Promise-based. This can cause race conditions in tests.

## Solution
Wrap the `db.run()` calls in Promises with resolve/reject pattern, matching the fix applied to the other test files.

## Expected Outcome
- All 3 instances in `server.test.ts` (lines 96, 128, 168) use the Promise-wrapped pattern
- Tests properly wait for database operations to complete
- No race conditions in server tests

## Considerations
- Consider extracting a shared helper function if this pattern is used frequently across test files
- File: `apps/user-server/src/__tests__/server.test.ts`
