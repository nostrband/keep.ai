# Spec: Centralize Tray Badge Updates

## Problem

Both WorkflowNotifications.ts and MainPage.tsx update the tray badge independently. This causes:
- Redundant IPC calls to Electron
- Potential flickering if counts differ temporarily
- Unclear ownership of badge state

## Solution

Centralize tray badge updates in one location - either WorkflowNotifications (since it already tracks attention state) or MainPage (since it has real-time UI state).

## Expected Outcome

- Single source of truth for tray badge count
- No redundant IPC calls
- Consistent badge state

## Considerations

- Determine which component should own the badge updates
- MainPage may have more accurate real-time count from its own data fetching
- WorkflowNotifications runs on db changes which may be more responsive
