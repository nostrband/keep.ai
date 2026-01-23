# Spec: Add error toast on task creation failure

## Problem
In `apps/web/src/components/MainPage.tsx`, when `api.createTask()` fails, only `console.error` is called. The user sees no visual feedback explaining what went wrong - the submission silently fails and the form becomes re-enabled.

## Solution
Add an error toast notification when task creation fails to inform the user.

## Expected Outcome
- User sees a toast message like "Failed to create automation. Please try again." when task creation fails
- Error is still logged to console for debugging
- User knows something went wrong and can retry

## Considerations
- Check if a toast library is already available in the app (react-hot-toast, sonner, etc.)
- Keep the error message user-friendly without exposing technical details
