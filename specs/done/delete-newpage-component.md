# Spec: Delete unused NewPage component

## Problem
After Spec 06 (Home Page Cleanup), the NewPage component at `apps/web/src/components/NewPage.tsx` is no longer imported or used anywhere. The /new route now redirects to / instead of rendering NewPage. This is dead code that should be removed.

## Solution
Delete the file `apps/web/src/components/NewPage.tsx`.

## Expected Outcome
- No dead code in the codebase
- Cleaner components folder

## Considerations
- Verify no other files import NewPage before deletion
