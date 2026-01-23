# Spec: Add file upload failure warning

## Problem
In `apps/web/src/components/MainPage.tsx`, when file uploads fail during task creation, the code proceeds with an empty attachedFiles array. The user's files are silently dropped without any notification - the task is created but without the intended attachments.

## Solution
Show a warning toast when file upload fails, informing the user that some files failed to upload while the task was still created.

## Expected Outcome
- User sees a warning like "Some files failed to upload" when file upload fails
- Task creation continues (current behavior preserved)
- User is aware their attachments may be missing

## Considerations
- Decide whether to show which specific files failed
- Consider whether to block task creation on upload failure (probably not - current behavior is reasonable)
- May want to show partial success if some files uploaded and others didn't
