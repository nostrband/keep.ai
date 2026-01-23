# Spec: Fix Pause Notification Grammar

## Problem
The pause-all notification in App.tsx uses incorrect grammar for the singular case. The message "All automation have been paused" should be "All automation has been paused" when count=1.

Current code:
```
body: `All ${workflowWord} have been paused. They will not run until you resume them.`
```

This produces grammatically incorrect text when only one automation is paused.

## Solution
Adjust the verb form based on count, or simplify the message to avoid the issue entirely.

## Expected Outcome
- Grammatically correct notification text for both singular and plural cases
- "All automation has been paused" for count=1
- "All automations have been paused" for count>1

## Considerations
- File: `apps/web/src/App.tsx`
- Could use `const verb = count === 1 ? 'has' : 'have'`
- Alternative: rephrase to avoid the issue (e.g., "Paused successfully" or always use plural framing)
