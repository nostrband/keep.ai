# Spec: Extract Disconnect Logic to Mutation Hook

## Problem

In `ConnectionsSection.tsx`, the disconnect functionality is implemented inline in the component instead of using a mutation hook like other database mutations in `dbWrites.ts`.

This breaks the established architectural pattern where all database/API mutations are encapsulated in reusable hooks.

Issues with current approach:
- Mutation logic is scattered (others in hooks, this one in component)
- Less reusable if disconnect is needed elsewhere
- No TanStack Query mutation benefits (loading states, retry, optimistic updates)
- Inconsistent with codebase conventions

## Solution

Create a `useDisconnectConnection` hook in `apps/web/src/hooks/dbWrites.ts` that encapsulates the disconnect logic:

- Makes the DELETE request to the connectors API
- Handles success by invalidating queries and notifying tables changed
- Returns standard mutation object with loading/error states

Update `ConnectionsSection.tsx` to use the new hook.

## Expected Outcome

- Disconnect logic follows the same pattern as other mutations
- Consistent architecture across the codebase
- Access to mutation loading/error states in the component
- Reusable if disconnect needed in other components

## Considerations

- Check if there are other inline mutations in the codebase that should also be extracted
- Consider whether optimistic updates make sense for disconnect
