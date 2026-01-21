# Spec: Add user feedback for pause-all operation

## Problem

When the user clicks "Pause all automations" from the tray menu, there is no confirmation or feedback. The operation completes silently and the UI updates reactively after DB sync, leaving users uncertain whether the action succeeded.

## Solution

Add visual feedback when the pause-all operation completes:

- Show a toast notification or success message indicating how many workflows were paused
- Handle error cases with appropriate error feedback
- Consider showing feedback even from the Electron tray context (OS notification or window focus with message)

## Expected Outcome

- User sees confirmation like "Paused 5 workflows" after clicking pause-all
- Error cases show appropriate message (e.g., "Failed to pause some workflows")
- Feedback appears even if the app window wasn't visible

## Considerations

- The handler runs in App.tsx which may not have direct access to toast/notification components
- May need to emit an event or use a global notification system
- Consider whether to show OS notification (from main process) or in-app toast (from renderer)
- Should handle partial failures (some workflows paused, some failed)
