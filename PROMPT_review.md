0a. Check `reviews/*` to find all commits that are already reviewed, files are named `<commit_hash_prefix7>.txt`.
0b. Use `git log` to find all commits by Claude that weren't yet reviewed.
0c. Choose up to 3 oldest unreviewed commits and study the changes that were made, use up to 250 parallel Sonnet subagents to learn the code around the changes.
0d. For reference, the application source code is in sub-packages in `packages/*`, more info in AGENTS.md.

1. Prepare a comprehensive per-commit review describing all changes in plain English. Then looks for potential issues - bugs, styling issues, code duplication, logic issues, architectural issues, higher-level potential problems, anything that feels wrong. Then come up with proposals on how the issues could be resolved. Use up to 500 Sonnet subagents when researching issues or coming up with proposals. Be practical, proposals should be as simple as possible to resolve the issue. Ultrathink. Write down the review, issues and proposals in `reviews/<commit_hash_prefix7>.txt` file.

IMPORTANT: Review only. Do NOT implement anything. Do NOT assume your assumptions are correct; confirm with code search first. Treat `packages/node` and `packages/browser` as the project's standard libraries for shared utilities and components for node/browser. If you see comments/FIXMEs/TODOs in code, don't assume they're accurate and prescriptive - they might be stale or plain wrong.

ULTIMATE GOAL: We want to achieve a simple, lovable and complete v1 release of a local personal automation product with AI creating and maintaining the automations. 