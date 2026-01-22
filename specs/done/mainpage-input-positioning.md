# Main Page Input Positioning

## Current Behavior
The "New Workflow" text input is fixed at the bottom of the viewport, regardless of whether workflows exist or not.

## Expected Behavior

### When workflows exist:
1. The input should be positioned at the **top** of the content area, above the workflow list
2. The input section should have the title "Create new automation"
3. Below the input should be a "Workflows" section title
4. Then the workflow list follows

### When no workflows exist:
1. The input should be **centered** on the screen (vertically and horizontally)
2. No separate "Workflows" section should be shown
3. Keep the existing empty state structure but reorganize elements

## Affected Files
- `apps/web/src/components/MainPage.tsx` - main page layout

## Layout Structure (with workflows)
```
[Header]
[Create new automation]
  [Input box]
[Workflows]
  [Workflow 1]
  [Workflow 2]
  ...
```

## Layout Structure (no workflows)
```
[Header]
      (vertical centering)
  [Sparkles icon]
  "Create your first automation"    <- title, replaces "No automations yet"
  "Type below or try one of these examples"   <- subtitle, keep as-is
  [Input textarea]                  <- move from bottom to here
  [Example suggestion buttons]      <- keep as-is
      (vertical centering)
```

## Notes
- The input should no longer be in a fixed position at the bottom
- Use flexbox centering for the empty state
- The attention banner (if any) should still appear at the top when workflows exist
- Remove the fixed bottom input container entirely - input is always inline with content
