# Workflow Page: Move "What This Automation Does" Section Up

## Summary

On the workflow page, the "What this automation does" box (containing summary and Mermaid diagram) should be moved up to appear right under the "Workflow" metadata box, before the Chat/Task/Script sections.

## Current Behavior

Current section order in `WorkflowDetailPage.tsx`:
1. Error Alert (line 239)
2. Workflow Metadata box (lines 244-377)
3. Chat Section (lines 380-404)
4. Task Section (lines 407-428)
5. Script Section (lines 431-561)
6. **What This Automation Does** (lines 564-581) <- Currently here
7. Script Runs List (lines 584-643)

## Root Cause

The "What this automation does" section was added later and placed at the bottom of the content flow, but conceptually it should appear near the top since it describes what the workflow does at a high level.

## Required Changes

### File: `apps/web/src/components/WorkflowDetailPage.tsx`

Move the "What This Automation Does" section (lines 564-581) to appear right after the Workflow Metadata box (after line 377).

The section to move:
```tsx
{/* What This Automation Does - Summary and Diagram */}
{activeScript && (activeScript.summary || activeScript.diagram) && (
  <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
    <h2 className="text-lg font-semibold text-gray-900 mb-4">What This Automation Does</h2>

    {/* Summary */}
    {activeScript.summary && (
      <p className="text-gray-700 mb-4">{activeScript.summary}</p>
    )}

    {/* Mermaid Diagram - rendered via markdown code fence */}
    {diagramMarkdown && (
      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <Response>{diagramMarkdown}</Response>
      </div>
    )}
  </div>
)}
```

New section order should be:
1. Error Alert
2. Workflow Metadata box
3. **What This Automation Does** <- Move here
4. Chat Section
5. Task Section
6. Script Section
7. Script Runs List

## Files to Modify

1. **`apps/web/src/components/WorkflowDetailPage.tsx`**
   - Move lines 564-581 to after line 377 (after Workflow Metadata closing div)

## Testing

- [ ] "What This Automation Does" section appears right under Workflow Metadata
- [ ] Summary text displays correctly
- [ ] Mermaid diagram renders correctly in new position
- [ ] Other sections (Chat, Task, Script, Runs) still appear in correct order below
- [ ] Fullscreen mermaid still works from new position
