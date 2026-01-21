# Spec: Remove Duplicate parseAsks Code

## Problem

The `parseAsks` function and `StructuredAsk` interface are duplicated in two locations:
- `apps/web/src/lib/parseAsks.ts`
- `packages/agent/src/ai-tools/ask.ts`

The agent package already exports these via `index.ts`, but the web app imports from its local duplicate instead.

## Solution

Delete `apps/web/src/lib/parseAsks.ts` and update the web app to import from the agent package.

## Expected Outcome

- Single source of truth for `parseAsks` and `StructuredAsk`
- Web app imports from `@app/agent` package
- No duplicate code to maintain

## Considerations

- May need to add `@app/agent` to web app's package.json dependencies if not already present
