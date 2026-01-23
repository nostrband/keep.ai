# Spec: Move formatCronSchedule to lib directory

## Problem
The `formatCronSchedule` utility function is defined and exported from a UI component file (`apps/web/src/components/WorkflowInfoBox.tsx:12`). This violates separation of concerns - utility functions shouldn't live in component files.

The function is imported by multiple components:
- WorkflowInfoBox.tsx (origin)
- MainPage.tsx:10
- WorkflowDetailPage.tsx:18

## Solution
Move `formatCronSchedule` to a dedicated utility file:
1. Create `apps/web/src/lib/formatCronSchedule.ts`
2. Move the function there
3. Update all imports to use the new location

## Expected Outcome
- Clean separation between UI components and utility functions
- Easier to find and maintain utility functions
- Follows standard project organization conventions

## Considerations
- Check if there are other utility functions in component files that should also be moved
- Consider creating a `lib/` or `utils/` folder if it doesn't exist
