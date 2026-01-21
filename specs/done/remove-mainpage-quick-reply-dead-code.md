# Spec: Remove Dead Quick-Reply Code from MainPage

## Problem

MainPage.tsx contains quick-reply code that calls `useTaskByChatId("main")`, but there is no task with `chat_id = "main"` in the database. The MainPage only has a chat input for creating new tasks - it doesn't have an actual ongoing chat conversation.

This results in dead code that always returns null and the quick-reply buttons never appear.

## Solution

Remove the dead quick-reply related code from MainPage.tsx:
- Remove `useTaskByChatId("main")` call
- Remove related `useTaskState` call
- Remove `quickReplyOptions` useMemo
- Remove `handleQuickReply` callback
- Remove QuickReplyButtons rendering

## Expected Outcome

- Cleaner MainPage.tsx without dead code
- No unnecessary hook calls or computations
- Quick-reply functionality remains working on ChatPage where it's actually used

## Considerations

- If quick-reply is later needed on MainPage, a different design would be required since MainPage doesn't have an associated task
