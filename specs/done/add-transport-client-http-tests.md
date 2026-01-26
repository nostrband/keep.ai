# Spec: Add TransportClientHttp Tests

## Problem

The TransportClientHttp class has no dedicated tests. While the Transport interface is simple and the implementation follows standard patterns, SSE-specific integration tests would add confidence in the connection lifecycle and error handling.

## Solution

Add integration tests for TransportClientHttp covering:

1. **Connection lifecycle**
   - Successful SSE connection establishment
   - Connection state transitions
   - Proper cleanup on close

2. **Error recovery and reconnection**
   - Handling connection errors
   - Reconnection logic after failures
   - Backoff behavior

3. **Message handling**
   - Message parsing from SSE stream
   - Callback serialization
   - Handling malformed messages

## Expected Outcome

- Test coverage for TransportClientHttp SSE functionality
- Confidence in Node.js polyfill behavior matching browser native EventSource
- Regression protection for connection handling changes

## Considerations

- File: `packages/tests/src/transport-client-http.test.ts` (new)
- May need to mock EventSource or use a test SSE server
- Consider testing both browser-native and polyfill code paths
- The eventsource polyfill may have subtle differences worth documenting through tests
