# Spec: Extract shared message parsing utility

## Problem
In `apps/web/src/hooks/dbChatReads.ts`, both `useChatMessages` and `useChatEvents` have identical try/catch JSON.parse fallback logic for parsing ChatMessage content into AssistantUIMessage format. This code duplication violates DRY principle and makes maintenance harder.

## Solution
Extract the JSON parsing logic into a shared utility function that can be reused by both hooks.

## Expected Outcome
- Single source of truth for message content parsing
- Both hooks use the shared utility
- Fallback behavior is consistent and easier to modify
- Reduced code duplication

## Considerations
- Decide where to place the utility (same file or separate utils file)
- Ensure the fallback structure matches what consumers expect
