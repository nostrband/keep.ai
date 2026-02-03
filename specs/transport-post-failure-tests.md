# Spec: Add Tests for POST Endpoint Failures in TransportClientHttp

## Problem

The TransportClientHttp integration tests verify message sending when the server is unavailable or the peer is unknown, but don't test what happens when the POST endpoints (/sync, /data) return error responses like 500 or timeout.

This leaves a gap in test coverage for error handling behavior.

## Solution

Add integration tests that configure the mock server to return error responses and verify the transport handles them gracefully:

- Test 500 responses from /sync endpoint
- Test 500 responses from /data endpoint
- Test timeout scenarios (if applicable)
- Verify the transport doesn't throw and handles errors appropriately

## Expected Outcome

- Test coverage for POST endpoint error scenarios
- Confidence that transport handles server errors gracefully
- Regression protection for error handling code paths

## Considerations

- May need to extend the mock server to support configurable error responses
- Consider whether errors should trigger reconnection or just be logged
