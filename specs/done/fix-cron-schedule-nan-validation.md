# Spec: Add NaN validation to formatCronSchedule

## Problem
In `apps/web/src/components/WorkflowInfoBox.tsx:33-36`, the `formatCronSchedule` function parses cron expression parts using `parseInt` but doesn't validate the result:

```typescript
const hourNum = parseInt(hour, 10);
const displayHour = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
```

`parseInt` returns NaN for non-numeric strings. Without validation, malformed cron expressions could display "NaN:NaN AM" in the UI.

## Solution
Add NaN validation after parsing:

```typescript
const hourNum = parseInt(hour, 10);
const minuteNum = parseInt(minute, 10);
if (isNaN(hourNum) || isNaN(minuteNum)) {
  return cron; // Return raw cron for invalid format
}
```

## Expected Outcome
- Malformed cron expressions display the raw cron string instead of "NaN:NaN AM"
- Valid cron expressions still display human-readable format
- No UI breakage from bad data

## Considerations
- Consider validating other cron parts (day, month, etc.) if used
- Could add more comprehensive cron parsing/validation library if needed
