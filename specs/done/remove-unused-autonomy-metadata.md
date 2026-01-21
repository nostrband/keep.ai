# Spec: Remove Unused Autonomy Metadata Field

## Problem

The `autonomy` field was added to the message metadata schema in `packages/proto/src/schemas.ts` but is never read or written anywhere in the codebase. It's dead code.

## Solution

Remove the unused `autonomy` field from the message metadata schema.

## Expected Outcome

- Cleaner schema without unused fields
- No dead code in the metadata definition

## Considerations

- None - the field is completely unused
