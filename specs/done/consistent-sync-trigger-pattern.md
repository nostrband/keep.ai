# Spec: Consistent Sync Trigger Pattern

## Problem

The `/api/connect` endpoint uses `await peer.checkLocalChanges()` directly, while other endpoints (`/api/set_config`, `/api/file/upload`) use the non-blocking `triggerLocalSync()` helper. This inconsistency makes the codebase harder to understand and maintain.

## Solution

Update `/api/connect` to use `triggerLocalSync()` instead of calling `peer.checkLocalChanges()` directly, matching the pattern used by other mutation endpoints.

## Expected Outcome

- All endpoints that trigger sync use the same `triggerLocalSync()` helper
- Consistent fire-and-forget pattern across the codebase
- Easier to understand and maintain sync behavior

## Considerations

- Verify the async callback context in `/api/connect` doesn't require the await behavior for correctness
