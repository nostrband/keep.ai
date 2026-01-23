# Spec: Clean up unused imports after chat_messages migration

## Problem
After the Spec 12 migration from chat_events to chat_messages, some imports are no longer used:
- `apps/web/src/hooks/dbWrites.ts`: `ChatEvent` and `UseChatEventsResult` imports are unused

There may be other unused imports in files touched by the migration.

## Solution
Remove unused imports from files affected by the chat_messages migration.

## Expected Outcome
- No unused imports related to the old chat_events API
- Cleaner codebase
- No TypeScript/linter warnings about unused imports

## Considerations
- Check other migration-affected files for similar cleanup opportunities
- Could be combined with other small cleanup tasks
