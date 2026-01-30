# Spec: Include Full Changelog in Maintainer Context

## Problem

The maintainer context changelog is silently truncated to 5 entries. If many fix attempts have occurred for the current major version, the maintainer agent won't see all prior attempts and may repeat unsuccessful approaches.

## Solution

Include all changelog entries for the current major version instead of limiting to 5. The changelog should only contain entries from the same major version (e.g., all 2.x fixes when working on version 2).

## Expected Outcome

- Maintainer sees complete history of fix attempts for current major version
- No repeated unsuccessful fix approaches
- Agent has full context for making informed fix decisions

## Considerations

- Verify changelog is already scoped to current major version (not all versions)
- Consider token usage - if a major version has excessive fix attempts, the context may grow large (but this scenario suggests deeper issues anyway)
