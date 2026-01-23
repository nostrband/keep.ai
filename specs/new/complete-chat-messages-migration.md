# Spec: Complete chat_messages migration in server and CLI

## Problem
The Spec 12 migration from chat_events to chat_messages is incomplete. While the web UI and agent code now use the new chat_messages table, the server and CLI still call `getChatMessages()` which reads from the deprecated chat_events table:
- `apps/server/src/server.ts:323` - Push notifications logic
- `apps/server/src/server.ts:925` - /api/set_config endpoint
- `apps/cli/src/commands/chat.ts:52` - CLI chat command

This causes data inconsistency where messages written by the agent are not visible to these components.

## Solution
Replace all remaining calls to `getChatMessages()` with `getNewChatMessages()` from the new Spec 12 API in server.ts and chat.ts.

## Expected Outcome
- All server endpoints read from chat_messages table
- CLI chat command reads from chat_messages table
- Data consistency across all components
- Deprecated getChatMessages() can be safely removed

## Considerations
- Verify the response format is compatible (may need JSON parsing adjustments)
- Check if there are other files still using deprecated methods
- Consider adding a deprecation warning to the old method
