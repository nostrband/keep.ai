# Spec: Fix Tool Always Saves, Only Skips Becoming Active

## Problem

Current behavior: When race condition is detected (planner updated while maintainer was working), the fix is discarded entirely. Maintainer's work is lost.

This is wasteful and the logic is confusing - maintainer has to understand race conditions.

## Solution

Change the fix tool behavior:

1. **Always save the fix** - The fix should always be saved as a new minor version of the major version the maintainer was working on
2. **Race check uses active_script_id** - Compare `workflow.active_script_id` against the script ID the maintainer is fixing
3. **Only skip becoming active** - If active_script_id changed (planner updated), don't update `active_script_id` to the new fix
4. **Maintainer doesn't know/care** - The agent just saves its fix and finishes. No need to handle race conditions in agent logic.

The fix result can simply indicate success - the fix was saved. Whether it became active is an implementation detail the maintainer doesn't need to know.

## Expected Outcome

- Maintainer's work is never discarded
- Fixes are preserved as minor versions (v1.1, v1.2) even if planner made v2.0
- Cleaner mental model - maintainer just fixes, doesn't handle race conditions
- Fix history is preserved for inspection or potential rollback

## Considerations

- The `expectedMajorVersion` parameter can be replaced with `expectedScriptId` (the script ID maintainer is fixing)
- When fix doesn't become active, maintenance flag should still be cleared
- Consider whether fix result should indicate "saved but not activated" vs "saved and activated" - or just return success either way
