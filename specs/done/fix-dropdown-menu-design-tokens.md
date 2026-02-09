# Fix: Restore Design Tokens and Transform-Origin in Dropdown Menu

## Problem

Commit 8961656 attempted to fix CSS variable syntax in dropdown-menu.tsx but introduced two regressions:

1. **Missing transform-origin**: `origin-[var(--radix-dropdown-menu-content-transform-origin)]` was removed from both `DropdownMenuContent` and `DropdownMenuSubContent`. This breaks Radix UI's transform-origin animations.

2. **Hardcoded colors**: All CSS variable design tokens were replaced with hardcoded Tailwind colors, breaking design system consistency:
   - `bg-popover` -> `bg-white`
   - `text-popover-foreground` -> `text-gray-900`
   - `focus:bg-accent` -> `focus:bg-gray-100`
   - `text-muted-foreground` -> `text-gray-500`
   - `bg-border` -> `bg-gray-200`

## Impact

- Dropdown animations open from wrong origin point
- Design tokens in `tailwind.config.js` have no effect on dropdown menu
- Inconsistent with `select.tsx` and `hover-card.tsx` which correctly use design tokens
- Prevents future theming/dark mode
- Focus state loses golden accent color (`--accent: 42 67% 55%`)

## Fix

### DropdownMenuContent (line ~42)

Add `origin-[var(--radix-dropdown-menu-content-transform-origin)]` and restore design tokens:
```
bg-popover text-popover-foreground border
```

### DropdownMenuSubContent (line ~243)

Same as above.

### All interactive items (MenuItem, CheckboxItem, RadioItem, SubTrigger)

Replace:
- `focus:bg-gray-100 focus:text-gray-900` -> `focus:bg-accent focus:text-accent-foreground`
- `data-[state=open]:bg-gray-100` -> `data-[state=open]:bg-accent`

### Separator

Replace `bg-gray-200` -> `bg-border`

### Shortcut, Label sublabel text

Replace `text-gray-500` -> `text-muted-foreground`

## Also fix tooltip.tsx

`tooltip.tsx` has the same hardcoded color issue (though it does have transform-origin). Replace hardcoded colors with design tokens to match `hover-card.tsx` and `select.tsx`.

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/ui/components/ui/dropdown-menu.tsx` | Restore design tokens + add transform-origin |
| `apps/web/src/ui/components/ui/tooltip.tsx` | Restore design tokens |

## Reference

Correct pattern from `select.tsx`:
```
bg-popover text-popover-foreground ... origin-[var(--radix-select-content-transform-origin)]
```

Correct pattern from `hover-card.tsx`:
```
bg-popover text-popover-foreground ... origin-[var(--radix-hover-card-content-transform-origin)]
```
