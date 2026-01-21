# Spec: Fix Max Retry Escalation Using Wrong Database Method

## Problem

In workflow-scheduler.ts, when max network retries are exceeded, the code uses `updateWorkflow()` with a partial object instead of `updateWorkflowFields()`. The `updateWorkflow()` method expects a complete Workflow object, so passing only `id` and `status` causes all other workflow fields (title, cron, next_run_timestamp, task_id, etc.) to be set to undefined/null.

The `as any` type cast was used to bypass TypeScript's type checking, masking this bug.

## Solution

Replace the `updateWorkflow()` call with `updateWorkflowFields()` which is designed for atomic partial updates. Remove the `as any` type cast to restore type safety.

## Expected Outcome

- When max retries are exceeded, only the `status` field is updated to 'error'
- All other workflow metadata (title, cron, task_id, etc.) is preserved
- TypeScript type checking is restored (no `as any` cast)

## Considerations

- The same code block has a fire-and-forget pattern where retry state is deleted before the DB update succeeds - consider if that should also be addressed
- Consider emitting a `needs_attention` signal when max retries are exceeded, similar to auth/permission errors
