# Spec: Add Range Validation to formatCronSchedule

## Problem

In `formatCronSchedule.ts`, all `parseInt` calls have NaN validation, but there's no range validation. Out-of-range values display impossible times:

- "75 * * * *" → "Every hour at :75" (minutes must be 0-59)
- "0 99 * * *" → "Every day at 87:00 PM" (hours must be 0-23)

## Solution

Add range validation after the NaN checks. If values are out of range, fall back to returning the raw cron string (same as NaN handling):

```typescript
if (minuteNum < 0 || minuteNum > 59) return cron;
if (hourNum < 0 || hourNum > 23) return cron;
```

## Expected Outcome

- Invalid cron expressions with out-of-range values fall back to showing the raw cron string
- No impossible times like ":75" or "99:00" are displayed
- Consistent defensive approach with existing NaN handling

## Considerations

- Apply range validation to all numeric fields (minute, hour, day of month, month, day of week)
- Day of month: 1-31
- Month: 1-12
- Day of week: 0-7 (both 0 and 7 represent Sunday)
