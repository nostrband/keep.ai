# Spec: Remove parseAsks re-export from @app/agent

## Problem

The `parseAsks` function and `StructuredAsk` type were moved to `@app/proto` but are still re-exported from `@app/agent/src/ai-tools/ask.ts` for backward compatibility. This backward compatibility is not needed.

## Solution

Remove the re-export from `@app/agent` and update any remaining imports to use `@app/proto` directly.

## Expected Outcome

- No re-export of `parseAsks` or `StructuredAsk` from `@app/agent`
- All imports come directly from `@app/proto`
- Cleaner package boundaries
