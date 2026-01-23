# Workflow Page: Mermaid Fullscreen Background Color

## Summary

When clicking the "full screen" button on a Mermaid diagram on the workflow page, the diagram is shown with a transparent background, making the workflow details visible underneath. The fullscreen view should use the main background color instead.

## Current Behavior

- Mermaid diagram is rendered via the `Response` component which uses the `streamdown` npm library
- The fullscreen overlay has a transparent background
- Workflow page content is visible through the fullscreen diagram

## Root Cause

The Mermaid fullscreen functionality is provided by the `streamdown` library (an npm package). The Response component at `apps/web/src/ui/components/ai-elements/response.tsx` simply passes through to Streamdown:

```tsx
export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      rehypePlugins={[...]}
      className={cn(...)}
      {...props}
    />
  ),
  ...
);
```

The fullscreen styling is controlled within the streamdown library itself, not in the application code.

## Required Changes

### Option A: CSS Override (Recommended)

Add a global CSS override to style the streamdown fullscreen overlay.

**File: `apps/web/src/index.css` or equivalent global styles**

```css
/* Override streamdown Mermaid fullscreen background */
/* The exact selector may need adjustment based on streamdown's DOM structure */
.streamdown-fullscreen,
[data-streamdown-fullscreen],
.mermaid-fullscreen {
  background-color: #f9fafb !important; /* gray-50 */
}

/* Alternative: if using a dialog/modal pattern */
.streamdown-modal-backdrop,
.streamdown-fullscreen-overlay {
  background-color: rgba(249, 250, 251, 0.98) !important; /* gray-50 with slight transparency */
}
```

### Option B: Check streamdown Configuration

Check if the streamdown library accepts configuration for fullscreen styling:

```tsx
<Streamdown
  fullscreenClassName="bg-gray-50"  // if such prop exists
  // or
  mermaidOptions={{
    fullscreen: {
      backgroundColor: '#f9fafb'
    }
  }}
  {...props}
/>
```

### Option C: Inspect DOM and Override

1. Use browser DevTools to inspect the fullscreen overlay element when triggered
2. Identify the exact class names or data attributes used
3. Add appropriate CSS overrides

## Investigation Steps

1. Click fullscreen button on a Mermaid diagram
2. Inspect the fullscreen overlay in DevTools
3. Note the class names and structure
4. Check `node_modules/streamdown/` for the fullscreen implementation
5. Add appropriate CSS override based on findings

## Files to Modify

1. **`apps/web/src/index.css`** (or global stylesheet)
   - Add CSS override for streamdown fullscreen background

2. **Possibly `apps/web/src/ui/components/ai-elements/response.tsx`**
   - If streamdown supports configuration props for fullscreen

## Testing

- [ ] Click fullscreen button on Mermaid diagram
- [ ] Fullscreen view has solid background (gray-50 or white)
- [ ] Workflow page content is NOT visible through fullscreen overlay
- [ ] Close button / escape key still works to exit fullscreen
- [ ] Diagram is properly centered and readable in fullscreen
- [ ] Dark mode (if applicable) has appropriate background color
