# Highlight Significant Events

## Problem Statement

Currently, all events in the chat interface and workflow run logs are displayed with uniform visual styling. Users scrolling through a long conversation or reviewing workflow history have difficulty quickly identifying the events that matter most - failures, fixes, user interactions, and important state changes.

This makes it harder to:
- Quickly spot what went wrong in a failed run
- See where the AI made corrections (maintenance mode fixes)
- Find places where user input was requested or provided
- Distinguish routine operations from meaningful outcomes

## Definition of "Significant" Events

Significant events fall into these categories:

### 1. Failure Events (Red/Error Styling)
Events that indicate something went wrong that may need attention:
- **Error events**: Run failures, exception throws
- **Auth errors**: OAuth expired, credential issues (requires user action)
- **Permission errors**: Access denied, insufficient scope (requires user action)
- **Network errors**: Connection failures, timeouts (transient but notable)

### 2. Fix/Resolution Events (Green/Success Styling)
Events that indicate a problem was resolved:
- **Maintenance fixed**: Agent auto-fixed a script issue
- **Retry succeeded**: A previously failed operation now works
- **User-resolved**: User provided input that unblocked the workflow

### 3. User Interaction Events (Blue/Highlight Styling)
Events that involve user participation:
- **User messages**: User replies in chat
- **Quick-reply selections**: User clicked a suggestion button
- **Input provided**: User answered an agent question (wait/asks states)
- **Manual triggers**: User clicked "Run now" or "Retry"

### 4. State Change Events (Yellow/Warning Styling)
Events that indicate important state transitions:
- **Maintenance started**: Agent entered maintenance mode to fix an issue
- **Maintenance escalated**: Auto-fix failed, needs user attention
- **Workflow paused**: Automation was disabled
- **Workflow activated**: Automation was enabled

### 5. Write/Create Actions (Subtle Emphasis)
Events where the automation made persistent changes:
- **Script saved**: New or updated script version
- **Note created/updated**: Data was written
- **File saved**: Output was produced
- **Task created**: New automation spawned

## Visual Treatment

### Event Item Styling (EventItem.tsx)

Current styling is uniform:
```
border border-gray-100 rounded-full bg-gray-50 text-gray-500
```

Proposed significant event styling:

| Category | Border | Background | Text |
|----------|--------|------------|------|
| Normal | `border-gray-100` | `bg-gray-50` | `text-gray-500` |
| Error | `border-red-200` | `bg-red-50` | `text-red-700` |
| Success/Fix | `border-green-200` | `bg-green-50` | `text-green-700` |
| User Interaction | `border-blue-200` | `bg-blue-50` | `text-blue-700` |
| State Change | `border-yellow-200` | `bg-yellow-50` | `text-yellow-700` |
| Write Action | `border-gray-200` | `bg-white` | `text-gray-700` |

### Event Group Header Styling (WorkflowEventGroup.tsx, TaskEventGroup.tsx)

Propagate significance to group level:
- If any event in group is an error: show red left border on header
- If group contains a fix: show green indicator in header
- If run ended with error: red status indicator in header
- If run succeeded after previous failure: green "recovered" indicator

Example header with error:
```tsx
<div className="border-l-4 border-l-red-500 bg-red-50">
  <span className="text-red-600">Failed: Authentication expired</span>
</div>
```

Example header with fix:
```tsx
<div className="border-l-4 border-l-green-500 bg-green-50">
  <span className="text-green-600">Fixed: Updated Gmail API call</span>
</div>
```

### Status Indicators in Group Headers

Add optional status icon/badge in group headers:
- Error icon for failed runs
- Check icon for successful runs after failure
- Wrench icon for maintenance mode
- User icon for runs triggered by user input

## Implementation Approach

### Phase 1: Classify Events by Significance

Add significance classification to events system:

```typescript
// In types/events.ts
export type EventSignificance =
  | 'normal'      // Routine operations
  | 'error'       // Failures
  | 'success'     // Fixes, resolutions
  | 'user'        // User interactions
  | 'state'       // State changes
  | 'write';      // Write/create actions

// Add to EVENT_CONFIGS
export interface EventConfig {
  emoji: string;
  title: (payload: EventPayload) => string;
  hasId: boolean;
  getEntityPath?: (payload: EventPayload) => string;
  significance: EventSignificance;  // NEW
}
```

Update EVENT_CONFIGS with significance for each event type:
- `create_note`, `update_note`, `file_save`, `add_script` -> `write`
- `add_task` -> `write` (or `state` if it's a workflow creation)
- `gmail_api_call`, `web_fetch`, `web_search` -> `normal`
- Future error events -> `error`
- Future fix events -> `success`

### Phase 2: Add New Event Types

Add new event types for significant moments (some may already exist):

```typescript
// New event types to add
export const EVENT_TYPES = {
  // ...existing...

  // Error events
  RUN_FAILED: "run_failed",
  AUTH_ERROR: "auth_error",

  // Fix events
  MAINTENANCE_FIXED: "maintenance_fixed",
  RETRY_SUCCEEDED: "retry_succeeded",

  // State events
  MAINTENANCE_STARTED: "maintenance_started",
  MAINTENANCE_ESCALATED: "maintenance_escalated",
  WORKFLOW_PAUSED: "workflow_paused",
  WORKFLOW_ACTIVATED: "workflow_activated",
};
```

### Phase 3: Update EventItem Component

```tsx
// In EventItem.tsx
const significanceStyles: Record<EventSignificance, string> = {
  normal: "border-gray-100 bg-gray-50 text-gray-500",
  error: "border-red-200 bg-red-50 text-red-700",
  success: "border-green-200 bg-green-50 text-green-700",
  user: "border-blue-200 bg-blue-50 text-blue-700",
  state: "border-yellow-200 bg-yellow-50 text-yellow-700",
  write: "border-gray-200 bg-white text-gray-700",
};

export function EventItem({ type, content, timestamp, usage }: EventItemProps) {
  const config = EVENT_CONFIGS[type];
  const significance = config?.significance || 'normal';
  const styleClass = significanceStyles[significance];

  return (
    <div className={`... ${styleClass} ...`}>
      {/* ... */}
    </div>
  );
}
```

### Phase 4: Update Event Group Components

Update WorkflowEventGroup and TaskEventGroup to:
1. Detect if any contained event has error significance
2. Detect if the run itself failed (from scriptRun/taskRun data)
3. Apply appropriate header styling
4. Show status badge/icon

```tsx
// In WorkflowEventGroup.tsx
const hasError = events.some(e => EVENT_CONFIGS[e.type]?.significance === 'error');
const runFailed = scriptRun?.error;
const showErrorStyling = hasError || runFailed;

return (
  <div className={`... ${showErrorStyling ? 'border-l-4 border-l-red-500' : ''}`}>
    {/* ... */}
  </div>
);
```

### Phase 5: Runtime Significance Detection

For events where significance depends on runtime data:
- Check if `scriptRun.error` exists -> mark workflow group as error
- Check if `scriptRun.retry_count > 0` and success -> mark as recovery
- Check if workflow `maintenance` flag transitioned -> state event

## Relationship to Collapse Feature

This feature is complementary to "Collapse low-signal events":

1. **Collapse hides, Highlight emphasizes**: Collapsed events become less prominent while highlighted events become more prominent
2. **Default view priority**: Show significant events expanded, collapse routine events
3. **Filter integration**: "Show all" expands collapsed events; significant events are never auto-collapsed
4. **Visual hierarchy**: Even when collapsed, error/success badges should be visible in the collapsed summary

Example interaction:
- A workflow run with 15 Gmail reads and 1 error
- Without collapse: 16 events shown, hard to spot error
- With collapse: "15 Gmail operations" collapsed, error event highlighted in red
- User immediately sees what matters

## Files to Modify

1. `apps/web/src/types/events.ts` - Add significance to EventConfig
2. `apps/web/src/components/EventItem.tsx` - Apply significance-based styling
3. `apps/web/src/components/WorkflowEventGroup.tsx` - Group header highlighting
4. `apps/web/src/components/TaskEventGroup.tsx` - Group header highlighting
5. `packages/agent/src/*.ts` - Emit new event types for maintenance fixes, errors

## Testing Considerations

- Verify color contrast meets accessibility standards (WCAG AA)
- Test with color blindness simulations
- Ensure status icons provide non-color differentiation
- Test with long event lists to verify visual scannability

## Future Enhancements

- Animated pulse for newly arrived significant events
- Sound/haptic feedback for error events (optional, user preference)
- Event significance in notifications (error events get urgent styling)
- Analytics: track which significant events users click most
