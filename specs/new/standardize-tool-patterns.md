# Spec: Standardize Tool Creation Patterns

## Problem
The codebase has two inconsistent tool creation patterns:

- **Pattern A** (AI SDK's `tool()`): Most tools use this, which properly handles ToolCallOptions (toolCallId, messages, abortSignal)
- **Pattern B** (plain objects): Some tools like get-script.ts, list-scripts.ts, list-script-runs.ts use plain objects with single-argument execute functions

Pattern B tools silently ignore the second argument (ToolCallOptions), meaning:
- No access to abortSignal for cancellation
- No access to toolCallId for tracking/debugging
- Inconsistent behavior across tools

## Solution
Audit all tools in `packages/agent/src/tools/` and standardize on Pattern A using `tool()` from AI SDK.

## Expected Outcome
- All tools use consistent AI SDK `tool()` pattern
- All tools receive and can utilize ToolCallOptions
- Easier to add cancellation support in the future
- Better debugging with toolCallId access

## Considerations
- Files to audit: `packages/agent/src/tools/` directory
- Pattern B tools to convert: get-script.ts, list-scripts.ts, list-script-runs.ts, and others
- This is a refactoring task - behavior should remain the same initially
- Post-v1 can add actual abortSignal checking for long-running operations
