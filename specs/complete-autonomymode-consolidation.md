# Spec: Complete AutonomyMode type consolidation

## Problem

The AutonomyMode type was consolidated to @app/proto, but two files still use inline type definitions `'ai_decides' | 'coordinate'` instead of importing the type:
- `packages/agent/src/task-worker.ts`
- `packages/db/src/api.ts`

This creates maintenance risk if the type definition changes in the future.

## Solution

Update the remaining files to import and use the `AutonomyMode` type from `@app/proto` instead of inline type definitions.

## Expected Outcome

- All usages of the autonomy mode type reference the single definition in @app/proto
- No inline `'ai_decides' | 'coordinate'` type definitions remain in the codebase
