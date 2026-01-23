# Spec: Test boolean-to-integer conversion edge cases

## Problem
The `maintenance` field in Workflow is stored as INTEGER (0/1) in SQLite but exposed as boolean in the TypeScript interface. Current tests cover basic toggle but don't verify:
- Round-trip conversion correctness (boolean -> DB -> boolean)
- Behavior with unexpected DB values (2, -1, NULL)

This pattern may exist in other fields as well.

## Solution
Add test cases in script-store.test.ts that verify boolean field handling:
- Write true/false and read back to confirm correct values
- Directly insert unexpected integer values and verify how they're interpreted
- Document expected behavior for edge cases

## Expected Outcome
- Tests verify boolean values survive round-trip correctly
- Behavior with non-standard integer values is documented and tested
- Any similar boolean fields elsewhere are identified and tested

## Considerations
- Decide on expected behavior for values like 2 or -1 (treat as truthy? error?)
- May want to add validation at the store layer if edge cases are problematic
