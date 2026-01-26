# Spec: Fix Hourly Cron Pattern NaN Validation

## Problem

The `formatCronSchedule` function was partially fixed to handle NaN validation for daily and weekly cron patterns, but the hourly pattern was missed. When the minute field contains a non-numeric value, the function outputs "Every hour at :NaN" instead of falling back to the raw cron string.

## Solution

Add the same NaN validation pattern used for daily/weekly to the hourly format branch. Parse the minute value, check for NaN, and return the raw cron string if invalid.

## Expected Outcome

- Hourly cron patterns with invalid minute values fall back to displaying the raw cron string
- Consistent validation behavior across all cron pattern types (hourly, daily, weekly)
- No "NaN" displayed in the UI for malformed cron expressions

## Considerations

- The fix should mirror the existing validation pattern already used for daily/weekly
- File: `apps/web/src/lib/formatCronSchedule.ts`
