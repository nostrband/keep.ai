# Spec: Fix Missing Awaits in Server Shutdown

## Problem

In the server's `close()` method, two async methods are called without `await`:

1. `nostr.stop()` - iterates over receivers/senders and awaits stopping each one
2. `peer.stop()` - sets flags and awaits stopping all transports

Without awaiting these calls, subsequent cleanup steps execute while these are still in progress:
- `peer.stop()` may run while nostr is still stopping
- `pool.close()` may run while peer is still using it
- Database may close while peer is still performing operations

## Solution

Add `await` to both `nostr.stop()` and `peer.stop()` calls in the server shutdown sequence:

```typescript
// 3. Stop transports
await nostr.stop();  // Add await
http.stop();

// 4. Stop the cr-sqlite peer
await peer.stop();  // Add await
```

## Expected Outcome

- Shutdown sequence respects async operation completion
- No race conditions during graceful shutdown
- All resources properly cleaned up in correct order

## Considerations

- Verify `http.stop()` is synchronous or also needs await
- Consider adding debug logging before each await to track shutdown progress
