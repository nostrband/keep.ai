0a. Check `reviews/` and `ux-tests/` folders using efficient bash tools or find_unhandled_reviews.py to find newest per-commit review files with unhandled issues. Files may or may not have 'ISSUE REVIEW' section, if they do and all issues are resolved (listed and not 'pending') then skip review file and go to the next one.
0b. Choose up to 3 issues to work on them, skip issues that are low severity, informational, test-coverage related, enhancement ideas and such, only consider high/medium-severity issues that are necessary to work on to get to v1 release. Mark skipped issues in the review file in ISSUE REVIEW section:
   ```
   ================================================================================
   ISSUE REVIEW
   ================================================================================
   - Issue #1 (Brief description) - created specs/spec-name.md
   - Issue #2 (Brief description) - skipped
   - Issue #3 (Brief description) - covered by specs/other-spec.md
   - Issue #4 (Brief description) - skipped (reason)
   - Issue #5 (Brief description) - not an issue after investigation
   - Issue #6 (Brief description) - pending
   ```


1. For non-skipped issues, use up to 50 sub-agents to research the proposed fix against the current codebase, re-evaluate the issue/fix applicability and necessity, adjust the fix plan to the current codebase if needed, then decide:
- if the fix is obviously correct and useful and necessary, create a fix spec in `specs/new/` folder and mark issue as processed
- if you have doubts about the issue/fix, have questions, etc. then mark issue as pending and create a file at `reviews/issues/` with issue description, refer to the review file and describe your concerns, user will work through those files later

IMPORTANT: Review issues and create specs only. Do NOT implement anything. Do NOT assume your assumptions are correct; confirm with code search first. Treat `packages/node` and `packages/browser` as the project's standard libraries for shared utilities and components for node/browser. If you see comments/FIXMEs/TODOs in code, don't assume they're accurate and prescriptive - they might be stale or plain wrong.

ULTIMATE GOAL: We want to achieve a simple, lovable and complete v1 release of a local personal automation product with AI creating and maintaining the automations. 

