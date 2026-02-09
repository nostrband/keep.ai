# Commit Review Issue Handling

Instructions for processing commit review files and creating issue-resolution specs.

## Workflow

1. **Go through reviews one by one** - Check `reviews/` and `ux-tests/` folders using efficient bash tools to find newest review files with unhandled issues. Files may or may not have 'ISSUE REVIEW' section, if they do and all issues are resolved (listed and not 'pending') then skip review and go to the next one.

2. **Within each review, go through issues one by one** - Don't batch issues, work on  each individually before moving to the next. Issue handling policy:
- skip informational issues, issues about test coverage, issues with 'enhancement proposals', anything that is clearly not necessary to get to v1
- for high/medium-severity issues, 

2.1. Show the issue summary (severity, brief description, etc) so user could give feedback and discuss a solution. In general, user will either propose to create a solution spec in `specs/new/` folder, or skip the issue with rationale. 

3. **Track progress in review files** - Add/update an `ISSUE REVIEW` section at the bottom of each review file:
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

## Writing Specs

**Specs should be high-level, describing WHAT should be done, not HOW.**

### Do:
- Describe the problem clearly
- Describe the desired behavior/outcome
- List considerations or open questions
- Mention files likely involved (if helpful)

### Don't:
- Include code snippets or precise implementation details

The implementing agent will dig deeper and may find a better-suited approach than what the review proposed.

### Spec Template:
```markdown
# Spec: Title

## Problem
[Describe what's wrong or missing]

## Solution
[Higher-level description of a proposed solution]

## Expected Outcome
- [Bullet points of what success looks like]

## Considerations (optional)
- [Open questions or things to think about]
```

## Handling Related Issues

- If previously discussed issue shares the same root cause, mention that for user consideration
- If one spec is created for several issues update all related review files to reference the shared spec
- When expanding a spec to cover more cases, rename it if the scope changed significantly

## Sub-agent Investigation

Use sub-agents when user asks to research the codebase when discussing an issue.
