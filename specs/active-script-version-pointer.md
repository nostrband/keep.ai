# Spec: Replace Rollback with Active Script Version Pointer

## Problem

The current rollback model creates a new script version copying old content. This leads to:
- Duplicate content in the database
- Version number inflation (v1 rollback creates v4, v5, etc.)
- Race conditions when computing next version number
- Non-idempotent operations (double-click creates duplicates)
- Performance overhead from `getLatestScriptByWorkflowId()` queries

## Solution

Add an `active_script_id` field to the workflows table that points to which script version should be executed. Replace the "rollback" concept with simply changing this pointer.

Key changes:
1. Add `active_script_id` column to workflows table
2. Scheduler fetches script by `active_script_id` directly (no "latest" query needed)
3. "Rollback" becomes "activate" - just updates the pointer to an existing version
4. New script versions automatically become active (or prompt user)

## Expected Outcome

- Script versions are immutable history records
- Switching between versions is instant (pointer update only)
- No duplicate content created
- No race conditions on version numbers for rollback
- Better performance - direct fetch by ID instead of "latest" query
- Simpler, reversible operations - can switch to any version freely
- Cleaner mental model matching how git works

## Considerations

- Migration needed to populate `active_script_id` for existing workflows (set to latest version)
- UI should clearly show which version is "active" vs just existing
- When creating new script version, decide if it auto-activates or requires explicit activation
- Consider renaming "Rollback" button to "Activate" or "Use this version"
