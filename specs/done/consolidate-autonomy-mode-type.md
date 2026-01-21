# Spec: Consolidate AutonomyMode Type Definition

## Problem

The `AutonomyMode` type is defined identically in 3 separate locations:
- `packages/proto/src/schemas.ts`
- `packages/agent/src/agent-env.ts`
- `apps/web/src/hooks/useAutonomyPreference.ts`

This creates maintenance risk - if a new mode is added, all 3 files must be updated.

## Solution

Use `packages/proto/src/schemas.ts` as the single source of truth for the `AutonomyMode` type. Update other files to import from there.

## Expected Outcome

- Single `AutonomyMode` type definition in `@app/proto`
- `agent-env.ts` and `useAutonomyPreference.ts` import from `@app/proto`
- Adding new modes only requires updating one file

## Considerations

- Ensure `@app/proto` is available as a dependency in all consuming packages
