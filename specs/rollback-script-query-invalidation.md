# Spec: Add Missing Query Invalidation for Script Rollback

## Problem

In dbWrites.ts, the rollback mutation's onSuccess handler invalidates workflow-related queries but misses `scriptVersions(taskId)`. If task-level script versions are displayed elsewhere in the UI, they would show stale data after a rollback.

## Solution

Add invalidation for `qk.scriptVersions(taskId)` in the rollback mutation's onSuccess handler when the target script has an associated task_id.

## Expected Outcome

- All UI components showing script versions update after rollback
- No stale data in task-level views
- Consistent cache invalidation across related queries

## Considerations

- Need to check if targetScript.task_id exists before invalidating
- This fix may become unnecessary if the rollback model changes to use active version pointer (see active-script-version-pointer.md spec)
