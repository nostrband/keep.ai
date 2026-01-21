# Spec: Extract Quick Reply Hook

## Problem

ChatPage.tsx and MainPage.tsx contain ~40 lines of near-identical code for handling quick reply functionality:
- Task fetching hooks (useTaskByChatId, useTaskState)
- quickReplyOptions useMemo logic
- handleQuickReply callback
- QuickReplyButtons JSX rendering

This duplication increases maintenance burden and risk of divergence.

## Solution

Extract the quick reply logic into a custom hook `useQuickReply(chatId)` that encapsulates all the shared functionality.

## Expected Outcome

- Single `useQuickReply` hook in `apps/web/src/hooks/`
- Hook returns `{ quickReplyOptions, handleQuickReply, isDisabled }`
- ChatPage and MainPage both use this hook
- Reduced code duplication

## Considerations

- The hook should handle the case where there's no task for the given chatId
- Consider whether QuickReplyButtons component should also be part of the abstraction
