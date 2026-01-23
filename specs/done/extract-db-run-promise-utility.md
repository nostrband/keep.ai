# Spec: Extract Shared db.run Promise Utility

## Problem
The Promise wrapper pattern for sqlite3's callback-based `db.run()` is duplicated across multiple test files:
- `database.test.ts`
- `integration.test.ts` (2 locations)
- `server.test.ts` (3 locations)

Each file manually creates the same Promise wrapper, which is verbose and error-prone. This violates DRY and makes maintenance harder.

## Solution
Create a shared utility function for promisifying `db.run()` calls in tests. Either:
1. A test utility function like `promisifyDbRun(db, sql, params)`
2. Or expose safe async methods from the Database class for testing purposes

## Expected Outcome
- Single source of truth for the Promise wrapper pattern
- Test files use the shared utility instead of inline Promise wrappers
- Reduced code duplication and improved maintainability
- Consistent error handling across all test files

## Considerations
- Location: Could be in a test utils file like `apps/user-server/src/__tests__/test-utils.ts`
- The Database class already promisifies its public methods - consider if tests should use those instead of accessing private `db` property
- Files affected: `database.test.ts`, `integration.test.ts`, `server.test.ts`
