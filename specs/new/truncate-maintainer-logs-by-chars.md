# Spec: Truncate Maintainer Logs by Character Count

## Problem

Log trimming currently splits on "\n" and takes last 50 lines. This doesn't handle:
- Very long lines that could blow up context
- Unusual line endings (\r\n)
- Logs with few but extremely long lines

## Solution

Truncate logs to 5000 characters max, taking the last 5000 characters regardless of line count.

## Expected Outcome

- Predictable context size for logs
- No risk of excessive token usage from long lines
- Simple, robust truncation logic

## Considerations

- Take the last 5000 chars (tail) so most recent output is preserved
- Consider adding "[truncated]" prefix if logs were cut
