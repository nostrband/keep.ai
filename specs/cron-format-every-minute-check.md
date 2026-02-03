# Spec: Fix "Every Minute" Check in formatCronSchedule

## Problem

In `formatCronSchedule.ts`, the "every minute" check only verifies minute and hour are wildcards:

```typescript
if (minute === "*" && hour === "*") {
  return "Every minute";
}
```

This means "* * 1 * *" (every minute on the 1st of the month) would incorrectly return "Every minute", which is misleading since it doesn't run every minute - only on the 1st.

## Solution

Check all five cron fields are wildcards before returning "Every minute":

```typescript
if (minute === "*" && hour === "*" && dayOfMonth === "*" &&
    month === "*" && dayOfWeek === "*") {
  return "Every minute";
}
```

If not all fields are wildcards, fall back to displaying the raw cron string or a more accurate description.

## Expected Outcome

- "* * * * *" correctly displays "Every minute"
- "* * 1 * *" falls back to raw cron string (not "Every minute")
- No misleading schedule descriptions

## Considerations

- May want to add more specific descriptions for partially-wildcard patterns (e.g., "Every minute on the 1st")
- For now, falling back to raw cron is acceptable for complex patterns
