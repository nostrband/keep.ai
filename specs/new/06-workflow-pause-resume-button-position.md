# Workflow Page: Fix Pause/Resume Button Position

## Summary

On the workflow page, the "Activate" button appears on the left (green, for 'ready' state). When clicked and the workflow becomes 'active', the "Pause" button doesn't appear in the same position - it appears somewhere to the right, which is confusing. The Pause/Resume buttons should replace the Activate button in the same position.

## Current Behavior

In `WorkflowDetailPage.tsx`, the buttons are rendered in this order within a flex container (lines 253-322):
1. Activate button (for status === "ready") - lines 255-264
2. Run now button (for draft/ready/active with script) - lines 266-276
3. Test run button (if has script) - lines 278-288
4. **Pause button** (for status === "active") - lines 290-299
5. **Resume button** (for status === "paused" or "error") - lines 302-311
6. Chat button - lines 313-321

The issue is that when workflow is "ready", Activate is first. When it becomes "active", Activate disappears but Pause comes after Run now and Test run, making it appear further right.

## Root Cause

The button order in the JSX places Pause/Resume after the Run now and Test run buttons. Since Activate only appears for "ready" status, and Pause/Resume appear for "active"/"paused"/"error", they never overlap - but they don't share the same position either.

## Required Changes

### File: `apps/web/src/components/WorkflowDetailPage.tsx`

Restructure the button layout so that Activate/Pause/Resume all occupy the same logical position (first button slot):

```tsx
<div className="flex gap-2">
  {/* Primary action button: Activate, Pause, or Resume - always first */}
  {workflow.status === "ready" && (
    <Button
      onClick={handleActivate}
      disabled={updateWorkflowMutation.isPending}
      size="sm"
      className="cursor-pointer bg-green-600 hover:bg-green-700 text-white"
    >
      Activate
    </Button>
  )}
  {workflow.status === "active" && (
    <Button
      onClick={handlePause}
      disabled={updateWorkflowMutation.isPending}
      size="sm"
      variant="outline"
      className="cursor-pointer"
    >
      Pause
    </Button>
  )}
  {(workflow.status === "paused" || workflow.status === "error") && (
    <Button
      onClick={handleResume}
      disabled={updateWorkflowMutation.isPending}
      size="sm"
      className="cursor-pointer bg-green-600 hover:bg-green-700 text-white"
    >
      Resume
    </Button>
  )}

  {/* Secondary actions: Run now, Test run, Edit */}
  {(workflow.status === "draft" || workflow.status === "ready" || workflow.status === "active") && activeScript && (
    <Button
      onClick={handleRunNow}
      disabled={updateWorkflowMutation.isPending}
      size="sm"
      variant="outline"
      className="cursor-pointer"
    >
      Run now
    </Button>
  )}
  {activeScript && (
    <Button
      onClick={handleTestRun}
      disabled={isTestRunning || updateWorkflowMutation.isPending}
      size="sm"
      variant="outline"
      className="cursor-pointer bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100"
    >
      {isTestRunning ? "Testing..." : "Test run"}
    </Button>
  )}
  {workflow?.chat_id && (
    <Button
      onClick={handleChat}
      size="sm"
      variant="outline"
      className="cursor-pointer"
    >
      Edit
    </Button>
  )}
</div>
```

Note: Also applying the "Chat" -> "Edit" rename from spec #04.

## Files to Modify

1. **`apps/web/src/components/WorkflowDetailPage.tsx`**
   - Reorder buttons so Activate/Pause/Resume are always first
   - Group them as mutually exclusive options in the same position

## Testing

- [ ] Ready workflow: Activate button is first (leftmost)
- [ ] Active workflow: Pause button is first (same position as Activate was)
- [ ] Paused workflow: Resume button is first (same position)
- [ ] Error workflow: Resume button is first (same position)
- [ ] Button transitions are smooth when status changes
- [ ] Run now, Test run, Edit buttons appear after the primary action button
