# Spec: Fix Server Shutdown Handling

## Problem

The server shutdown handler doesn't properly clean up all resources. Missing cleanup for:
- taskScheduler
- workflowScheduler
- connectionManager
- database pool
- cr-sqlite peer
- HTTP server
- nostr transports
- keepDB

This can cause resource leaks, uncommitted database changes, and orphaned processes on server restart or termination.

## Solution

Add comprehensive shutdown logic that gracefully stops all services in the correct order (dependent services first, then their dependencies).

## Expected Outcome

- All schedulers stop accepting new work and complete in-flight tasks
- Database connections are properly closed
- No orphaned processes or connections
- Clean shutdown without resource leaks
- Graceful handling of SIGTERM/SIGINT signals

## Considerations

- File: `apps/server/src/server.ts`
- Shutdown order matters: stop schedulers before closing database
- May need timeout for graceful shutdown before forced exit
- Consider logging shutdown progress for debugging
