# Move Autonomy Toggle into Input Box

## Current Behavior
The "AI decides details" / "Coordinate with me" toggle button is positioned below the input box, in a separate centered div.

## Expected Behavior
The autonomy toggle should be moved **inside** the input box toolbar, positioned to the **right of the + (attach file) button**.

## Current Layout
```
[Input textarea]
[+ button]                    [Submit button]

        [AI decides details ⓘ]
```

## Expected Layout
```
[Input textarea]
[+ button] [AI decides ⓘ]    [Submit button]
```

## Affected Files
- `apps/web/src/components/MainPage.tsx` - move the toggle from outside to inside PromptInputTools

## Implementation Approach
The autonomy toggle (currently in a separate div after the PromptInput component) should be moved into the `PromptInputTools` section of the toolbar, appearing after the + button.

## Notes
- The toggle should maintain its current styling (text button with info icon)
- The tooltip should still work when hovering
- The toggle should be visually distinct from the + button but part of the toolbar
- Consider adjusting sizing/spacing to fit comfortably in the toolbar
