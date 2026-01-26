# Spec: Fix Google Tools Event Tracking Pattern

## Problem

The Google tools (gdrive.ts, gsheets.ts, gdocs.ts) use `method.includes()` for event tracking conditions (e.g., `method.includes("create")`). This pattern is fragile and could match unintended methods if new methods are added in the future (e.g., `precreate` would match `create`).

## Solution

Replace the fragile `includes()` pattern with explicit method matching. Define a list of write methods that should trigger events and check against that list using exact matching (e.g., `endsWith()` or set membership).

## Expected Outcome

- Event tracking only fires for explicitly defined methods
- No risk of false positives from partial string matches
- Consistent pattern across all Google tools (gdrive, gsheets, gdocs)

## Considerations

- Can be combined with the gdrive event tracking fix (add missing methods while fixing the pattern)
- Each tool may have different write methods to track
- Files: `packages/agent/src/tools/gdrive.ts`, `packages/agent/src/tools/gsheets.ts`, `packages/agent/src/tools/gdocs.ts`
