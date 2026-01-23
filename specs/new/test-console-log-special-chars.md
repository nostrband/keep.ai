# Spec: Test console-log with special characters

## Problem
The consoleLogTool formats output by wrapping messages in single quotes (`'message'`). There are no tests verifying behavior when messages contain special characters like single quotes, newlines, or other problematic characters. This could cause log parsing or display issues.

## Solution
Add test cases to utility-tools.test.ts that verify consoleLogTool handles special characters correctly in messages.

## Expected Outcome
- Test covers messages containing single quotes
- Test covers messages with newlines
- Test covers messages with other special characters (tabs, unicode, etc.)
- Behavior is documented and consistent

## Considerations
- Decide whether special characters should be escaped or passed through as-is
- Consider if current behavior is acceptable or needs implementation changes
