# Spec: Complete tool error classification migration

## Problem

The error classification system was introduced but only 7 of ~30+ tools were updated to throw classified errors:

**Updated:** gmail.ts, web-fetch.ts, web-download.ts, text-extract.ts, web-search.ts, read-file.ts, save-file.ts

**Not updated:** get-weather.ts, images-generate.ts, task-update.ts, send-email.ts, and many others

Unclassified errors from non-updated tools default to `LogicError` in sandbox/api.ts, which may not be accurate. For example, a network timeout in images-generate would be classified as LogicError instead of NetworkError, leading to incorrect routing (maintenance mode instead of retry).

## Solution

Audit all remaining tools in `/packages/agent/src/tools/` and update them to throw appropriate classified errors (AuthError, PermissionError, NetworkError, LogicError, InternalError) based on the error conditions they can encounter.

## Expected Outcome

- All tools throw properly classified errors
- Network errors trigger retry behavior instead of maintenance mode
- Auth/permission errors route to user notification
- Error routing matches the actual error cause

## Considerations

- Prioritize tools that make external API calls (more likely to have network/auth errors)
- Some tools may only throw logic errors legitimately
- Review error classification functions in errors.ts for patterns to follow
