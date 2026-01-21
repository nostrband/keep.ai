# Spec: App Update Notification

## Problem

When the service worker updates and a new version of the web app is activated, users have no indication that the app has been updated. The update happens silently in the background.

## Solution

Add a subtle UI notification when the app has been updated, informing users that a new version is now active.

## Expected Outcome

- Users see a brief, non-intrusive notification when the app updates
- Notification indicates a new version is available/active
- Users understand why behavior might have changed or new features appeared

## Considerations

- Keep notification subtle and non-disruptive (toast, small banner, etc.)
- Consider whether to show "refresh recommended" or just informational
- Notification should auto-dismiss or be easily dismissable
