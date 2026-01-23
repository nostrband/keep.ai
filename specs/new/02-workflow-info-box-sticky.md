# Chat Detail Page: Sticky Workflow Info Box

## Summary

On the chat detail page (`ChatDetailPage.tsx`), the workflow info box should:
1. Stick to the top below the header when scrolling down (not disappear)
2. Have a pointer cursor on hover (currently uses default cursor)

## Current Behavior

- The `WorkflowInfoBox` is rendered in a regular `<div>` that scrolls away
- The component uses `<button>` element but lacks explicit cursor styling
- When user scrolls down, the workflow context is lost

## Root Cause

### Issue 1: Not Sticky
The workflow info box is placed in a normal flow `<div>` at line 121-125 of `ChatDetailPage.tsx`:
```tsx
{workflow && (
  <div className="max-w-4xl mx-auto px-6 pt-4">
    <WorkflowInfoBox workflow={workflow} onClick={handleWorkflowClick} />
  </div>
)}
```

### Issue 2: No Pointer Cursor
In `WorkflowInfoBox.tsx` line 67-69, the button has no cursor class:
```tsx
<button
  onClick={onClick}
  className="w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-left border border-gray-200"
>
```

## Required Changes

### File: `apps/web/src/components/ChatDetailPage.tsx`

Change the wrapper div to be sticky with proper z-index:
```tsx
{workflow && (
  <div className="sticky top-[49px] z-10 bg-gray-50 border-b border-gray-200">
    <div className="max-w-4xl mx-auto px-6 py-4">
      <WorkflowInfoBox workflow={workflow} onClick={handleWorkflowClick} />
    </div>
  </div>
)}
```

Note: `top-[49px]` accounts for the header height (adjust if header height is different).

### File: `apps/web/src/components/WorkflowInfoBox.tsx`

Add `cursor-pointer` to the button's className:
```tsx
<button
  onClick={onClick}
  className="w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-left border border-gray-200 cursor-pointer"
>
```

## Files to Modify

1. **`apps/web/src/components/ChatDetailPage.tsx`**
   - Wrap workflow info box in sticky container

2. **`apps/web/src/components/WorkflowInfoBox.tsx`**
   - Add `cursor-pointer` class to button

## Testing

- [ ] Workflow box stays visible at top when scrolling down
- [ ] Workflow box has correct background color when sticky
- [ ] Chat content scrolls behind the sticky box properly
- [ ] Cursor changes to pointer on hover over workflow box
- [ ] Clicking workflow box still navigates to workflow page
