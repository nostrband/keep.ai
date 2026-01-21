# Autonomy Tooltip Styling Issues

## Current Behavior
The tooltip that appears on hover over the "AI decides details" button has several visual issues:
1. Background appears transparent (no solid background)
2. Text is centered instead of left-aligned
3. There is an arrow/pointer element under the tooltip

## Expected Behavior
1. Tooltip should have a solid, opaque background with a visible border
2. Text content should be left-aligned
3. The arrow/pointer element should be removed

## Affected Files
- `apps/web/src/ui/components/ui/tooltip.tsx` - TooltipContent styling
- Possibly `apps/web/src/components/MainPage.tsx` - TooltipContent className overrides

## Current Tooltip Component Issues
Looking at `tooltip.tsx`:
- The `TooltipContent` uses `bg-foreground text-background` which may not be rendering correctly
- The `text-balance` class may be causing centering
- There is a `TooltipPrimitive.Arrow` element being rendered (line 53)

## Expected Styling
- Solid background color (e.g., white or light gray)
- Visible border (e.g., gray border)
- Left-aligned text
- No arrow element
- Appropriate padding and shadow for visibility

## Visual Comparison

### Current
```
      ┌─────────────────┐
      │  Centered text  │  <- transparent bg, no border
      └────────┬────────┘
               ▼           <- arrow to remove
```

### Expected
```
┌──────────────────────┐
│ Left-aligned text    │  <- solid bg, visible border
│ that wraps properly  │
└──────────────────────┘
                          <- no arrow
```
