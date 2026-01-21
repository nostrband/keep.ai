0a. Check `ux-tests/*` to find all commits that are already reviewed, files are named `<commit_hash_prefix>.txt`.
0b. Use `git log` to find all commits by Claude that weren't yet reviewed.
0c. Choose up to 3 oldest unreviewed commits and study the changes that were made, use up to 250 parallel Sonnet subagents to learn the code around the changes.
0d. For reference, the application source code is in sub-packages in `packages/*`, more info in AGENTS.md.

1. Your job is to test UX changes of each commit using playwright tool. Assume app is built properly for testing, start server for UX tests, use the tool to explore the features touched by the commit, check if it actually works as intended by the commit. If something important seems off, do not assume it's not relevant, test env issue, etc - count it as an issue. If issues found, use up to 500 Sonnet subagents to research the codebase, try to identify the bug and test your assumptions and expectations. Then prepare a report on the issue, how to reproduce, expected/given outcome, possible causes, etc. Ultrathink. Write down the reports in `ux-tests/<commit_hash_prefix>.txt` file.

IMPORTANT: UX test only. Do NOT implement anything. Do NOT assume your assumptions are correct; confirm with code search first. Treat `packages/node` and `packages/browser` as the project's standard libraries for shared utilities and components for node/browser. If you see comments/FIXMEs/TODOs in code, don't assume they're accurate and prescriptive - they might be stale or plain wrong.

ULTIMATE GOAL: We want to achieve a simple, lovable and complete v1 release of a local personal automation product with AI creating and maintaining the automations. 