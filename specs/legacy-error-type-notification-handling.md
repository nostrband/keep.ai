# Spec: Handle legacy empty error_type in WorkflowNotifications

## Problem

There is an inconsistency between MainPage.tsx and WorkflowNotifications.ts in handling legacy/unclassified errors (where `error_type` is an empty string):

- MainPage.tsx treats empty error_type as attention-needing: `(errorType === '' && !workflow.maintenance)`
- WorkflowNotifications.ts has no special handling for empty strings in NOTIFY_ERROR_TYPES or SILENT_ERROR_TYPES

This means MainPage shows attention indicators for legacy errors, but OS notifications may not fire consistently for these cases.

## Solution

Add handling for empty/legacy error_type in WorkflowNotifications.ts to match MainPage behavior:

- Either add empty string to NOTIFY_ERROR_TYPES for consistency
- Or explicitly handle the legacy case in the notification logic

## Expected Outcome

- Workflows with empty error_type (legacy/unclassified errors) receive OS notifications when not in maintenance mode
- Consistent behavior between MainPage attention indicators and OS notification triggering

## Considerations

- This is a transitional issue - new errors should have proper error_type classification
- Consider whether to treat legacy errors as needing attention or as silent
- May want to add migration or background job to classify old errors
