# Main Page Enter Key Submit Not Working

## Current Behavior
When typing text into the input field on the main page and pressing Enter, nothing happens. No workflow creation is triggered.

## Expected Behavior
Pressing Enter (without Shift) in the input field should submit the automation request, creating a new workflow. This matches the hint shown: "Press Enter to create automation".

## Investigation Notes
The submit flow should be:
1. User types in textarea
2. User presses Enter
3. `PromptInputTextarea.handleKeyDown` calls `form.requestSubmit()`
4. `PromptInput.handleSubmit` extracts text via `formData.get("message")`
5. Calls `onSubmit({ text, files }, event)` with the message
6. `MainPage.handleSubmit` receives the message and calls `addMessage.mutate()`

## Affected Files
- `apps/web/src/components/MainPage.tsx` - handleSubmit callback
- `apps/web/src/ui/components/ai-elements/prompt-input.tsx` - form submission handling

## Possible Issues to Investigate
- Check if `addMessage.mutate()` is being called and if it succeeds or fails silently
- Verify the FormData correctly contains the message text
- Check if there are any console errors during submission
- Verify the navigation or mutation completes as expected
- Check if the chatId "main" is valid and the message is properly persisted

## Acceptance Criteria
- Typing text and pressing Enter creates a new workflow/conversation
- User is navigated to the chat or workflow detail after submission
- Error states are properly handled and shown to the user if submission fails
