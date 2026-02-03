# Spec: Enable Skipped Compression Error Handling Tests

## Problem

Two important error handling tests in compression.test.ts are skipped:

```typescript
it.skip("should handle invalid gzip data", async () => {
it.skip("should handle truncated gzip data", async () => {
```

Comment mentions "zlib stream timing sensitivity" but these are critical error paths that should be tested.

## Solution

Find an alternative approach to test error handling for malformed gzip data:
- Synchronous validation before decompression
- Timeout-based verification
- Mock-based testing
- Or fix the underlying timing issue

## Expected Outcome

- Error handling for invalid/truncated gzip data is tested
- No skipped tests for critical error paths

## Considerations

- Understand why timing sensitivity causes issues before choosing approach
- May need to refactor decompression error handling to be more testable
