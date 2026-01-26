# Spec: Consolidate parseMessageContent Utility

## Problem
The `parseMessageContent` function (parsing ChatMessage to AssistantUIMessage) is duplicated in 3 locations:

1. `apps/web/src/hooks/dbChatReads.ts:18` - named function
2. `apps/cli/src/commands/chat.ts:24` - named function
3. `apps/server/src/server.ts:377` - inline try/catch

All three have identical logic: try to JSON.parse the content, fallback to constructing an AssistantUIMessage with the raw content as text.

This violates DRY and means future changes to parsing logic require updates in 3 places.

## Solution
Create a shared utility function in a common package (e.g., `packages/db/src/chat-store.ts` or a new utils file) and import it in all 3 locations.

## Expected Outcome
- Single source of truth for message content parsing
- All 3 locations import and use the shared function
- Future changes only need to be made in one place

## Considerations
- Location options: `packages/db/src/chat-store.ts`, `packages/proto/src/utils.ts`, or new file
- Need to export the function and the AssistantUIMessage type
- The function should have explicit return type annotation: `AssistantUIMessage`
