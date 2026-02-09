# OAuth Scope Backward Incompatibility

**Source**: Review of commit 1356324
**Severity**: HIGH
**Status**: RESOLVED - Deferred for v1

## Issue

Commit 1356324 added `userinfo.email` scope to all Google services (Gmail, Drive, Sheets, Docs). Existing OAuth tokens granted without this scope will fail on token refresh, causing connections to silently enter "error" state.

## Current Behavior

1. User has existing Google connection with old scopes
2. Token expires and refresh is triggered
3. Google returns 400 `invalid_scope` (or similar)
4. `ConnectionManager.refreshToken()` catches error, calls `markError()`
5. Connection status becomes "error" in database
6. Workflow execution fails with `AuthError`
7. User only learns about the problem when they check Settings page (red error badge)

## Concerns

- **No proactive notification**: Users aren't told to re-authenticate until a workflow fails
- **Silent degradation**: Workflows stop working without clear explanation
- **No migration path**: No code detects "token has wrong scopes" and prompts re-auth

## Questions

1. Is this actually a problem for the current user base? If all users are re-connecting regularly during alpha, old tokens may not exist.
2. Should we add scope validation to `getCredentials()` that checks stored scopes against required scopes and prompts re-auth?
3. Is the Settings page "Reconnect" button sufficient recovery for alpha users?
4. Should the error classification treat 400 scope errors as `AuthError` instead of `LogicError` so the system handles them appropriately?

## Possible Approaches

- **Minimal**: Document in release notes that users should reconnect Google services after update
- **Medium**: Add scope validation in `ConnectionManager.getCredentials()` - if stored scope doesn't include required scopes, automatically mark as needing reconnection and notify user
- **Full**: On startup, check all stored credentials for scope mismatches and prompt re-auth proactively

## Files Involved

- `packages/connectors/src/services/google.ts` - Scope definitions
- `packages/connectors/src/manager.ts` - Token refresh and error handling
- `packages/connectors/src/types.ts` - `OAuthCredentials.scope` field (stored but never validated)
- `packages/proto/src/errors.ts` - HTTP 400 classified as `LogicError` instead of `AuthError`

## Resolution

**Decision**: Deferred - not blocking v1.

**Reasoning**: This is an alpha product where users reconnect accounts frequently. The existing error flow is sufficient: old token fails on refresh → connection marked as "error" in Settings → user sees red badge → clicks "Reconnect" → re-authenticates with new scopes → works. The scenario requires a user who connected Google services before commit 1356324 AND hasn't reconnected since. Given the alpha stage with frequent iterations, this is unlikely to affect real users.

**Post-v1 consideration**: If scope changes become more frequent or the user base grows beyond alpha testers, implement the "Medium" approach (scope validation in `getCredentials()`) to provide a better UX.
