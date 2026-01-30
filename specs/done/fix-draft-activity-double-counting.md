# Spec: Fix Draft Activity Double-Counting Bug

## Problem

In `getDraftActivitySummary()`, drafts older than 30 days are counted in both `archivableDrafts` AND `abandonedDrafts`. This breaks the semantic meaning of each category - they should be mutually exclusive age brackets:
- staleDrafts: 3-7 days
- abandonedDrafts: 7-30 days
- archivableDrafts: 30+ days

Currently, the sum of categories can exceed `totalDrafts`, and the UI shows inflated abandoned counts.

## Solution

1. Fix the counting logic to make categories mutually exclusive (remove the double-counting line)
2. Update the UI banner to show both archivable and abandoned counts when applicable (remove else-if)
3. Update banner visibility condition to check `archivableDrafts` explicitly
4. Update test expectations to validate correct mutual-exclusivity behavior

## Expected Outcome

- Categories are mutually exclusive: a draft belongs to exactly one age bracket
- Sum of staleDrafts + abandonedDrafts + archivableDrafts <= totalDrafts
- UI shows accurate counts for each category
- Tests validate correct behavior

## Considerations

- The "backward compatibility" comment suggests this was intentional - verify no other code depends on the double-counting behavior before fixing
- Files involved: script-store.ts, StaleDraftsBanner.tsx, script-store.test.ts
