# Chat Page: Add AI Decides Toggle

## Summary

The input form on the chat page (`ChatPage.tsx`) is missing the "AI decides" / "Coordinate" autonomy toggle that exists on the homepage. Add this toggle for consistency.

## Current Behavior

- **Homepage (`MainPage.tsx`)**: Has autonomy toggle in the prompt input toolbar (lines 354-379)
- **Chat page (`ChatPage.tsx`)**: No autonomy toggle - only has the file attachment button

## Root Cause

The `ChatPage.tsx` component was created separately and simply never included the autonomy toggle that `MainPage.tsx` has.

## Required Changes

### File: `apps/web/src/components/ChatPage.tsx`

1. Import the autonomy hook and UI components:
   ```typescript
   import { useAutonomyPreference } from "../hooks/useAutonomyPreference";
   import { Info } from "lucide-react";
   import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui";
   ```

2. Add the hook usage inside the component:
   ```typescript
   const { mode: autonomyMode, toggleMode: toggleAutonomyMode, isLoaded: isAutonomyLoaded } = useAutonomyPreference();
   ```

3. Add the toggle button inside `<PromptInputTools>` (after the file attachment button, before `</PromptInputTools>`):
   ```tsx
   {isAutonomyLoaded && (
     <TooltipProvider>
       <Tooltip>
         <TooltipTrigger asChild>
           <button
             onClick={toggleAutonomyMode}
             className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors py-1 px-2 rounded hover:bg-gray-100"
           >
             <span>{autonomyMode === 'ai_decides' ? 'AI decides' : 'Coordinate'}</span>
             <Info className="size-3" />
           </button>
         </TooltipTrigger>
         <TooltipContent side="top" className="max-w-xs">
           <p className="font-medium mb-1">
             {autonomyMode === 'ai_decides' ? 'AI Decides Details' : 'Coordinate With Me'}
           </p>
           <p className="text-xs text-gray-600">
             {autonomyMode === 'ai_decides'
               ? 'The AI will minimize questions and use safe defaults to complete tasks quickly.'
               : 'The AI will ask clarifying questions before proceeding with key decisions.'}
           </p>
           <p className="text-xs text-gray-500 mt-1">Click to switch</p>
         </TooltipContent>
       </Tooltip>
     </TooltipProvider>
   )}
   ```

## Files to Modify

1. **`apps/web/src/components/ChatPage.tsx`**
   - Add imports for `useAutonomyPreference`, `Info`, and tooltip components
   - Add hook usage
   - Add toggle button in toolbar

## Testing

- [ ] Chat page shows autonomy toggle in input toolbar
- [ ] Toggle displays current mode ("AI decides" or "Coordinate")
- [ ] Clicking toggle switches between modes
- [ ] Tooltip appears on hover with mode description
- [ ] Toggle only appears after preference is loaded (no flash)
