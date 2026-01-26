# Spec: Smart Workflow Restore Status

## Problem

Currently, restoring an archived workflow always sets status to "draft" regardless of its previous state or configuration. This is suboptimal now that paused workflows can be archived:

- A fully configured workflow (with scripts) that was paused and archived comes back as "draft"
- User has to manually re-activate it even though it was previously working

## Solution

Restore workflows to an appropriate status based on their configuration:

- **Has scripts** → restore to "paused" (ready to run, user can activate when ready)
- **No scripts** → restore to "draft" (needs configuration before it can run)

This way:
- Configured workflows return to a "ready but inactive" state
- Incomplete workflows return to draft for further setup

## Expected Outcome

- Archived workflow with scripts restores to "paused" status
- Archived workflow without scripts restores to "draft" status
- User can immediately activate a restored configured workflow
- Incomplete workflows still need setup before activation

## Considerations

- Files: `apps/web/src/components/WorkflowDetailPage.tsx`, `apps/web/src/components/ArchivedPage.tsx`
- Need to check if workflow has associated scripts before setting status
- Could query scripts table or check a scripts count on the workflow object
- Both restore locations (WorkflowDetailPage and ArchivedPage) need this logic
