# Spec: Fix tasks.deleted Type Mismatch

## Problem

There's an inconsistency between production and test schemas for the `tasks.deleted` column:

- Production (migration v1): `deleted BOOLEAN DEFAULT FALSE`
- Test schema: `deleted INTEGER NOT NULL DEFAULT 0`

While SQLite treats BOOLEAN as INTEGER internally so it works in practice, this inconsistency undermines the goal of having test schemas match production exactly. It could mask subtle bugs where production and test behave differently.

## Solution

Align the type definitions between production and test schemas. Either:

1. Update test schema to use `BOOLEAN DEFAULT FALSE` to match production
2. Update production migration to use `INTEGER NOT NULL DEFAULT 0` (would require new migration)

Option 1 is simpler as it only changes test code.

## Expected Outcome

- Test schema exactly matches production schema for the `deleted` column
- No ambiguity about the intended data type
- Tests accurately reflect production behavior

## Considerations

- File: `packages/tests/src/task-store.test.ts`
- Production migrations: `packages/db/src/migrations/v1.ts`
- SQLite is loosely typed so this is a consistency issue, not a functional bug
- May want to audit other columns for similar type mismatches
