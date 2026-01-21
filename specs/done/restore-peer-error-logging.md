# Spec: Restore Error Logging in Peer.ts

## Problem

Critical error messages in packages/sync/src/Peer.ts were changed from `console.error` to `this.debug()`. The debug module is disabled by default and only outputs when the DEBUG environment variable is set.

This makes peer synchronization errors invisible in production, including:
- Unknown peer errors
- Wrong transport errors
- Database version initialization errors
- Queue callback errors (which are caught to prevent queue stalling)

## Solution

Restore `console.error` for critical error paths in Peer.ts. Reserve `this.debug()` for informational/diagnostic messages only.

## Expected Outcome

- Critical errors in Peer.ts are visible in production logs without requiring DEBUG env var
- Operators can diagnose peer synchronization failures
- Queue callback errors are no longer silently swallowed

## Considerations

- Review which specific log statements should be console.error vs debug
- Consider a consistent error logging strategy across the sync package
