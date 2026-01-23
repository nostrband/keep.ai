# Agent Save Tool: Add Required Title Field

## Summary

The agent planner has a tool to save workflow scripts, but it doesn't reliably set the workflow title. Add a required "title" field to the save tool, but only update the workflow title if it's currently empty in the database.

## Current Behavior

In `packages/agent/src/ai-tools/save.ts`:

The `SaveInfoSchema` (lines 5-19) includes:
- `code` (required)
- `comments` (optional)
- `summary` (optional)
- `diagram` (optional)

There is no `title` field. The agent sometimes sets the title through other means, but not consistently.

## Root Cause

The save tool was designed to save script code and metadata, but workflow title was expected to be set elsewhere. This leads to inconsistent title setting.

## Required Changes

### File: `packages/agent/src/ai-tools/save.ts`

1. Add `title` field to the schema:
```typescript
const SaveInfoSchema = z.object({
  code: z.string().describe("Script code to save"),
  title: z.string().describe("Title for the workflow/automation"),
  comments: z
    .string()
    .optional()
    .describe("Comment for the code or code changes"),
  summary: z
    .string()
    .optional()
    .describe("One-sentence description of what the automation does"),
  diagram: z
    .string()
    .optional()
    .describe("Mermaid diagram source showing the automation flow (flowchart)"),
});
```

2. Update the execute function to conditionally set title (after line 46, where we have the workflow):
```typescript
// Update workflow title only if currently empty
if (info.title && (!workflow.title || workflow.title.trim() === '')) {
  await opts.scriptStore.updateWorkflowFields(workflow.id, {
    title: info.title,
  });
}
```

3. If workflow status is draft, combine the title update with status update:
```typescript
if (workflow.status === 'draft') {
  const updates: any = {
    status: 'ready',
    active_script_id: newScript.id,
  };
  // Only set title if currently empty
  if (info.title && (!workflow.title || workflow.title.trim() === '')) {
    updates.title = info.title;
  }
  await opts.scriptStore.updateWorkflowFields(workflow.id, updates);
} else {
  const updates: any = {
    active_script_id: newScript.id,
  };
  // Only set title if currently empty
  if (info.title && (!workflow.title || workflow.title.trim() === '')) {
    updates.title = info.title;
  }
  await opts.scriptStore.updateWorkflowFields(workflow.id, updates);
}
```

4. Update the tool description to mention the title:
```typescript
description: `Save the new/updated script code with a workflow title, commit-style comments, summary, and optional flow diagram.
The title will only be applied if the workflow doesn't already have one.
`,
```

## Files to Modify

1. **`packages/agent/src/ai-tools/save.ts`**
   - Add `title` field to `SaveInfoSchema` (required string)
   - Update `SaveInfo` type (automatic from zod)
   - Add logic to update workflow title only if empty
   - Update tool description

## Testing

- [ ] Agent is required to provide title when calling save tool
- [ ] New workflows get their title set from save tool
- [ ] Existing workflows with titles are NOT overwritten
- [ ] Workflows with empty string titles get updated
- [ ] Workflows with whitespace-only titles get updated
- [ ] Title appears correctly on workflow page and homepage list
