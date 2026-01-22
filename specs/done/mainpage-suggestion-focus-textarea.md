# Spec: Focus textarea after clicking suggestion button

## Problem

On MainPage, when a user clicks one of the example suggestion buttons (e.g., "Send me a daily summary of my unread emails"), the suggestion text is populated into the textarea but focus remains on the clicked button.

This creates a confusing UX:
- The "Press Enter to create automation" hint appears
- But pressing Enter doesn't work because the textarea isn't focused
- User must manually click the textarea before they can submit

## Solution

Add focus management to the suggestion click handler. After setting the input text, focus the textarea so the user can immediately press Enter to submit.

## Expected Outcome

- Clicking a suggestion populates the textarea AND focuses it
- User can immediately press Enter to submit without additional clicks
- The "Press Enter" hint accurately reflects what the user can do

## Considerations

- Need a ref to the textarea element
- Consider whether to place cursor at end of text after focus
