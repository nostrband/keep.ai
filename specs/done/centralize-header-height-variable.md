# Spec: Centralize header height as CSS variable

## Problem
In `apps/web/src/components/ChatDetailPage.tsx:122`, the sticky positioning uses a hardcoded magic number:
```tsx
<div className="sticky top-[49px] z-10 ...">
```

This assumes SharedHeader height is exactly 49px. If header height changes (responsive design, design updates), this breaks silently.

## Solution
Define header height as a CSS custom property and use it everywhere:

1. Add to `apps/web/src/index.css`:
```css
:root {
  --header-height: 49px;
}
```

2. Update sticky elements to use the variable:
```tsx
<div className="sticky top-[var(--header-height)] z-10 ...">
```

3. Search for other hardcoded `49px` or `top-[49px]` values and update them.

## Expected Outcome
- Single source of truth for header height
- All sticky elements automatically update if header height changes
- Easier maintenance and responsive design support

## Considerations
- Search codebase for other places using hardcoded header height
- Could also add to Tailwind config as custom spacing if preferred
- Header component could dynamically set the variable if height varies
