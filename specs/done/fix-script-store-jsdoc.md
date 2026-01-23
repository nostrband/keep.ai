# Spec: Fix outdated JSDoc in script-store.ts

## Problem
JSDoc comment at `packages/db/src/script-store.ts:835` references the old table name and incorrect join key:
- Says: "Chat event timestamp (from chat_events table where chat_id = workflow.task_id)"
- Should say: "Chat message timestamp (from chat_messages table where chat_id = workflow.chat_id)"

This outdated documentation could confuse developers working on this code.

## Solution
Update the JSDoc comment to reference the correct table name (chat_messages) and join key (workflow.chat_id).

## Expected Outcome
- JSDoc accurately describes the current implementation
- Documentation matches the Spec 12 migration changes
