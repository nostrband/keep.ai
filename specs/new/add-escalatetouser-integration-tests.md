# Spec: Add Integration Tests for escalateToUser

## Problem

The maintainer integration tests manually implement escalation logic instead of calling the actual `escalateToUser` function from workflow-worker.ts. This leaves gaps in test coverage:

- User notification creation and content verification
- Message sending to user's chat
- Error handling during escalation
- Logging behavior

The test only verifies the manual workflow status updates, not the full escalation flow.

## Solution

Add integration tests that call the actual `escalateToUser` method (or refactor it to be more testable) to verify the complete escalation behavior including notifications and messages.

## Expected Outcome

- Tests verify notification is created with correct payload
- Tests verify message is sent to user's chat
- Tests verify error handling during escalation
- Full confidence in the escalation flow

## Considerations

- May need to refactor escalateToUser to be more testable (dependency injection for notifications/messages)
- Consider what level of mocking is appropriate vs end-to-end testing
