# Spec: Add Internal Error Classification

## Problem

ERROR_BAD_REQUEST indicates a bug in our code. Currently it gets an empty error_type string and is treated as a legacy error. It needs proper classification - the workflow should be stopped (can't be auto-fixed), and the user notified with guidance.

## Solution

Add a new error type 'internal' for bugs in our code:
- Classify ERROR_BAD_REQUEST as 'internal'
- Stop the workflow (set status to error, not maintenance mode)
- Notify user with message: "Something went wrong. Please contact support."
- Include 'internal' in ATTENTION_ERROR_TYPES so it shows in the attention list

## Expected Outcome

- New 'internal' error type in the classification system
- ERROR_BAD_REQUEST properly classified
- User sees clear "contact support" message
- Workflow stopped, not stuck in retry loop or maintenance mode

## Considerations

- Error details should be preserved for support/debugging
- Later this can be enhanced with in-app contact/bug-report feature
