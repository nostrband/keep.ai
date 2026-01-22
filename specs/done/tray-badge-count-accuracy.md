# Spec: Align tray badge count with notification-eligible workflows

## Problem

The tray badge count includes all workflows needing attention, but notifications are only sent for specific error types (auth, permission, network). This creates a mismatch where the badge might show "5 need attention" but the user only received 2 notifications.

This discrepancy is confusing - users expect the badge count to reflect what they were notified about.

## Solution

Align the badge count calculation with the notification eligibility criteria:

- Either count only `shouldNotify=true` workflows in the badge
- Or expand notifications to cover all attention-needing workflows
- Or clearly differentiate in the UI between "notified" and "needs attention"

## Expected Outcome

- Badge count matches the number of workflows the user was notified about
- Or badge clearly represents a different metric with appropriate UI labeling
- Consistent mental model for users about what the badge number means

## Considerations

- Decide which approach: narrow badge count or expand notifications
- Badge currently serves as "needs attention" indicator which is broader than "notified"
- May need to rethink the notification strategy if badge should match notifications
- Consider showing two numbers: "3 notified, 5 total need attention"
