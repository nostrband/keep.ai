# Spec: Expand Archive to Paused Workflows with Server Validation

## Problem

Currently, only draft workflows can be archived (UI restriction only). This is overly restrictive - users who have paused a workflow may also want to hide it from the main list. Additionally, there's no server-side validation, so the UI restriction could be bypassed via direct API calls.

## Solution

1. **Expand archiving to paused workflows**: Allow both "draft" and "paused" workflows to be archived. This makes sense because:
   - Both represent inactive workflows
   - User has already taken deliberate action to stop a paused workflow
   - Natural progression: pause → archive → (optionally) restore later

2. **Add server-side validation**: Reject archive operations on workflows with status other than "draft" or "paused". This prevents:
   - Archiving active/running workflows (could cause confusion)
   - Archiving "ready" workflows that haven't been explicitly paused

## Expected Outcome

- Users can archive both draft and paused workflows from the UI
- Server rejects attempts to archive active/ready/error workflows
- Archive button appears for both draft and paused workflows in WorkflowDetailPage
- Consistent behavior between UI and API

## Considerations

- Files:
  - `apps/web/src/components/WorkflowDetailPage.tsx` (update UI condition)
  - Server endpoint or mutation hook (add validation)
- Restoration still returns workflow to "draft" status (existing behavior)
- Consider what happens if a paused workflow had a schedule - after restore as draft, schedule is preserved but inactive until user activates
