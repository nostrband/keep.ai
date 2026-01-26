# Spec: Audit Workflow Timestamp Updates

## Problem
The `workflow.timestamp` field is meant to be a **creation timestamp** (as documented in `workflow-scheduler.ts:292`), but `updateWorkflow()` in `script-store.ts` currently updates this field on every workflow update.

This means the creation timestamp gets overwritten whenever any workflow field is modified, losing the original creation time.

## Solution
Audit all places that update workflow records and ensure `timestamp` is only set once during creation, never updated afterward.

## Expected Outcome
- `timestamp` field preserves the original workflow creation time
- `updateWorkflow()` and similar methods don't overwrite the creation timestamp
- Any code relying on `timestamp` as "last modified" should use a different field or approach

## Considerations
- Check if any code depends on `timestamp` being "last modified" time
- The `getDraftActivitySummary` function uses timestamps for activity detection - verify it uses the correct source (chat_messages, scripts, etc.)
- May need to add a separate `updated_at` field if "last modified" tracking is needed
- Files to audit: `packages/db/src/script-store.ts` (updateWorkflow, updateWorkflowFields)
