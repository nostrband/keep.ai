# Spec: Fix MainPage form submission to create tasks

## Problem

The MainPage form submission is broken - submitted automation requests are silently discarded.

**Current behavior:**
- MainPage uses `addMessage.mutate()` with `chatId: "main"`
- This creates an inbox item with `target: "worker"` and empty `target_id`
- TaskScheduler filters out inbox items with empty `target_id`
- The request disappears without any processing or error feedback

**Working behavior (NewPage):**
- NewPage uses `api.createTask()` which creates a task record, associated chat, and sends message with proper target_id
- User is navigated to the new chat
- Everything works correctly

## Solution

Update MainPage's `handleSubmit` to use `api.createTask()` like NewPage does, then navigate the user to the newly created chat.

## Expected Outcome

- Submitting from MainPage creates a new task/workflow
- User is navigated to the chat for the new task
- The AI agent processes the request
- Example suggestions actually lead to working automations

## Considerations

- Ensure the navigation happens after task creation succeeds
- Handle errors appropriately (show error message if task creation fails)
- Consider if MainPage needs any different behavior than NewPage, or if they should share the same submission logic
