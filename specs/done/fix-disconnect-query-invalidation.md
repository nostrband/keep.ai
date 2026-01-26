# Spec: Fix Disconnect Operation Query Invalidation

## Problem

When a user disconnects a service connection, the DELETE request to `/api/connectors/:service/:accountId` completes successfully, but the UI doesn't immediately reflect the change. The disconnected connection remains visible until the next cr-sqlite sync cycle.

The server endpoint doesn't call `notifyTablesChanged` after the disconnect operation.

## Solution

Ensure the connections list updates immediately after a successful disconnect. Either:
- Server-side: Call `notifyTablesChanged(["connections"], true, api)` after disconnect
- Client-side: Manually invalidate the connections query after successful DELETE

## Expected Outcome

- Disconnected connections disappear from the UI immediately after the operation completes
- No stale connection cards shown to the user

## Considerations

- Server-side fix is preferred for consistency with other mutation patterns
- Files: `apps/web/src/components/ConnectionsSection.tsx`, `apps/server/src/routes/connectors.ts`
