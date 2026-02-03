# Spec: Standardize React Query Mutation Error Handling

## Problem

The codebase uses inconsistent patterns for React Query mutation error handling:

- ArchivedPage.tsx uses async/await with try/catch and `mutateAsync`
- WorkflowDetailPage.tsx uses callback-based approach with `mutate`

This inconsistency makes the codebase harder to maintain and can confuse developers about which pattern to use.

## Solution

Standardize on one pattern across the codebase. The callback-based pattern with `mutate` is more idiomatic for React Query:

```typescript
mutate(data, {
  onSuccess: () => { /* handle success */ },
  onError: (error) => { /* handle error */ },
});
```

## Expected Outcome

- Consistent error handling pattern across all mutation usages
- Easier maintenance and code review
- Clear convention for new code

## Considerations

- Audit other components for similar inconsistencies
- The async/await pattern may be preferred in some cases (e.g., when sequential operations depend on the result) - document when exceptions are acceptable
- Consider adding a lint rule or code review guideline
