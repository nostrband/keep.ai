# Collapse Low-Signal Events

## Problem Statement

When viewing chat history or workflow run logs, users are overwhelmed by routine, low-value events. A single workflow run might generate dozens of events (Gmail API calls, file reads, web fetches), creating visual noise that makes it hard to identify what actually matters - errors, user interactions, and significant outcomes.

Current state:
- Every event is shown at the same visual prominence level
- Gmail API calls are already partially consolidated (multiple calls become one "Gmail: messages, threads" line), but other event types are not
- Users must scroll through many routine events to find errors or important actions
- Successful runs with no issues still display all their internal events, creating unnecessary clutter

## Goal

Reduce visual noise in the chat timeline by auto-collapsing routine "low-signal" events, while keeping high-signal events (errors, user interactions, write operations) visible. Users can expand collapsed sections to see full details when needed.

## What Counts as "Low-Signal" Events

### Low-Signal (Collapse by Default)
These events represent routine read operations or internal processing that usually succeed and don't need attention:

| Event Type | Reason |
|------------|--------|
| `gmail_api_call` (read methods) | Routine data fetching - already partially consolidated |
| `web_fetch` | Reading web pages is routine |
| `web_search` | Search queries are intermediate steps |
| `get_weather` | Simple data lookup |
| `text_extract` | Internal processing step |
| `text_classify` | Internal processing step |
| `text_summarize` | Internal processing step |
| `images_explain` | Analysis without side effects |
| `pdf_explain` | Analysis without side effects |
| `audio_explain` | Analysis without side effects |

### High-Signal (Always Visible)
These events represent outcomes, side effects, user interactions, or failures that users care about:

| Event Type | Reason |
|------------|--------|
| `create_note` | Creates user-visible artifact |
| `update_note` | Modifies user data |
| `delete_note` | Modifies user data |
| `add_task` | Creates new work item |
| `add_task_cron` | Creates recurring work |
| `cancel_this_task_cron` | Stops recurring work |
| `send_to_task_inbox` | Triggers another task |
| `task_update` | Modifies task state |
| `images_generate` | Creates visible output |
| `images_transform` | Creates visible output |
| `web_download` | Downloads file (potential large operation) |
| `file_save` | Writes to filesystem |
| `add_script` | Modifies automation code |
| `gmail_api_call` (write methods) | Sends emails, modifies inbox |
| `text_generate` | Creates content (user likely wants to see) |
| Any event with `error` | Failures always need attention |

### Context-Dependent
- `gmail_api_call`: Write methods (send, modify, delete, trash) are high-signal; read methods (list, get) are low-signal
- Events within a failed run should all be visible to aid debugging

## Proposed Solution

### UI Behavior

#### Collapsed State (Default for Low-Signal Groups)
When a workflow group or task group contains only low-signal events:

```
+----------------------------------------------------------+
| Executing: Daily Email Summary                    [...]  |
| > 5 routine events (Gmail read, web search, ...)  [Show] |
+----------------------------------------------------------+
```

- Shows a single summary line: "X routine events (type1, type2, ...)"
- Lists 2-3 unique event types for context
- "Show" button/chevron to expand
- Group header remains fully visible with title, cost, duration

#### Expanded State
```
+----------------------------------------------------------+
| Executing: Daily Email Summary                    [...]  |
| v 5 routine events                               [Hide]  |
|----------------------------------------------------------|
| Gmail: messages, threads                                 |
| Web Search: latest news about X                          |
| Fetched: https://example.com/article                     |
| Text: Summarized 2500 chars -> 150 chars                 |
| Text: Classified text -> "news"                          |
+----------------------------------------------------------+
```

#### Mixed Groups (Low + High Signal Events)
When a group contains both low-signal and high-signal events:

```
+----------------------------------------------------------+
| Executing: Daily Email Summary                    [...]  |
|----------------------------------------------------------|
| Saved: daily-summary.txt (2KB)                           |
| New Note: Email Summary for Jan 19                       |
| > 5 routine events (Gmail read, web search)       [Show] |
+----------------------------------------------------------+
```

- High-signal events are always shown in their natural order
- Low-signal events are collapsed into a summary row
- Collapsed summary appears at the bottom of the visible events

#### Error State
When a group contains errors, all events are shown (no collapsing):
- Errors need full context for debugging
- Users expect to see what happened before the error

### User Preferences (Future Enhancement)

Consider adding a toggle in settings:
- "Collapse routine events" (default: on)
- Could be per-workflow or global

### Data Structures

#### Event Signal Classification

Add a utility function to classify events:

```typescript
// /apps/web/src/lib/eventSignal.ts

import { EVENT_TYPES, EventType, EventPayload, GmailApiCallEventPayload } from '../types/events';

export type SignalLevel = 'high' | 'low';

// Gmail methods that write/modify data
const GMAIL_WRITE_METHODS = [
  'users.messages.send',
  'users.messages.modify',
  'users.messages.trash',
  'users.messages.untrash',
  'users.messages.delete',
  'users.drafts.create',
  'users.drafts.send',
  'users.drafts.update',
  'users.drafts.delete',
  'users.labels.create',
  'users.labels.update',
  'users.labels.delete',
];

const LOW_SIGNAL_EVENTS: EventType[] = [
  EVENT_TYPES.WEB_FETCH,
  EVENT_TYPES.WEB_SEARCH,
  EVENT_TYPES.GET_WEATHER,
  EVENT_TYPES.TEXT_EXTRACT,
  EVENT_TYPES.TEXT_CLASSIFY,
  EVENT_TYPES.TEXT_SUMMARIZE,
  EVENT_TYPES.IMAGES_EXPLAIN,
  EVENT_TYPES.PDF_EXPLAIN,
  EVENT_TYPES.AUDIO_EXPLAIN,
];

export function getEventSignalLevel(
  type: EventType,
  payload: EventPayload
): SignalLevel {
  // Gmail API calls depend on the method
  if (type === EVENT_TYPES.GMAIL_API_CALL) {
    const gmailPayload = payload as GmailApiCallEventPayload;
    const isWriteMethod = GMAIL_WRITE_METHODS.some(
      method => gmailPayload.method.includes(method)
    );
    return isWriteMethod ? 'high' : 'low';
  }

  // Check if in low-signal list
  if (LOW_SIGNAL_EVENTS.includes(type)) {
    return 'low';
  }

  // Default to high signal
  return 'high';
}

export function hasErrorInGroup(events: Array<{ content: any }>): boolean {
  return events.some(e => e.content?.error);
}
```

#### CollapsedEventSummary Component

Create a new component for the collapsed state:

```typescript
// /apps/web/src/components/CollapsedEventSummary.tsx

interface CollapsedEventSummaryProps {
  events: Array<{ type: string; content: any }>;
  isExpanded: boolean;
  onToggle: () => void;
}

export function CollapsedEventSummary({
  events,
  isExpanded,
  onToggle
}: CollapsedEventSummaryProps) {
  // Get unique event types for summary
  const uniqueTypes = [...new Set(events.map(e => e.type))];
  const typeLabels = uniqueTypes.slice(0, 3).map(getEventTypeLabel);

  return (
    <div
      className="flex items-center justify-between px-2 py-1 text-sm text-gray-500 cursor-pointer hover:bg-gray-100 rounded"
      onClick={onToggle}
    >
      <span>
        {isExpanded ? 'v' : '>'} {events.length} routine event{events.length > 1 ? 's' : ''}
        ({typeLabels.join(', ')}{uniqueTypes.length > 3 ? ', ...' : ''})
      </span>
      <span className="text-xs text-gray-400">
        {isExpanded ? 'Hide' : 'Show'}
      </span>
    </div>
  );
}
```

## Implementation Approach

### Files to Modify

1. **New file: `/apps/web/src/lib/eventSignal.ts`**
   - Event signal classification logic
   - Helper functions for grouping events by signal level

2. **Modify: `/apps/web/src/components/WorkflowEventGroup.tsx`**
   - Add state for collapsed/expanded
   - Separate events into high-signal and low-signal
   - Render CollapsedEventSummary for low-signal events
   - Skip collapsing if any event has error

3. **Modify: `/apps/web/src/components/TaskEventGroup.tsx`**
   - Same changes as WorkflowEventGroup

4. **New file: `/apps/web/src/components/CollapsedEventSummary.tsx`**
   - Reusable component for collapsed event summary

5. **Optional: `/apps/web/src/types/events.ts`**
   - Add `signalLevel` to EventConfig if we want to define it statically

### Implementation Steps

1. Create `eventSignal.ts` with classification logic
2. Create `CollapsedEventSummary.tsx` component
3. Update `WorkflowEventGroup.tsx`:
   - Import signal classification
   - Add `isCollapsed` state (default: true)
   - Partition events into high/low signal
   - Render high-signal events normally
   - Render CollapsedEventSummary for low-signal events
   - Auto-expand if any errors present
4. Apply same changes to `TaskEventGroup.tsx`
5. Test with various event combinations

### Estimated Effort

- Small (2-4 hours)
- Low risk - purely UI presentation change
- No database changes required
- No backend changes required

## Edge Cases to Consider

1. **Empty groups after filtering**
   - If a group has only low-signal events and is collapsed, the group header should still show
   - Don't hide groups entirely, just collapse their contents

2. **Groups with only one low-signal event**
   - Still collapse it, but maybe show more context in the summary
   - Alternative: don't collapse single events (not worth the extra click)

3. **Very long groups (50+ events)**
   - Current Gmail consolidation helps
   - Consider virtual scrolling for expanded state if needed
   - Or paginate: "Show 10 more..."

4. **Transition animations**
   - Use smooth height transitions for expand/collapse
   - Radix Collapsible component handles this

5. **Keyboard accessibility**
   - Expand/collapse should work with Enter/Space
   - Focus should move appropriately

6. **User clicks through to event details**
   - Clicking an event in expanded state should work normally
   - Navigation shouldn't be affected by collapse state

7. **Real-time updates**
   - New events arriving should maintain collapse state
   - Don't auto-expand when new low-signal events arrive

8. **Cost display**
   - Collapsed summary should show aggregate cost if any events have cost
   - "5 routine events ($0.03 total)"

9. **Mobile responsiveness**
   - Touch targets should be large enough
   - Summary text may need to truncate differently on mobile

## Success Metrics

- Reduced visual clutter in chat timeline
- Users can find errors and important events faster
- No increase in clicks needed to complete common tasks
- Positive user feedback on cleaner interface

## Future Enhancements

1. **Per-workflow collapse preferences**: Remember expand state per workflow
2. **Event type filtering**: Let users choose which events to always show
3. **Bulk actions**: "Expand all" / "Collapse all" controls
4. **Search within collapsed events**: Find specific events without expanding
5. **Aggregate metrics**: Show summaries like "Gmail: 15 messages processed"
