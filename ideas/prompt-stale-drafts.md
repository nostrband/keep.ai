# Prompt User About Stale Drafts

## Problem Statement

Users often start creating automations but abandon them partway through the process. These drafts sit in the workflow list indefinitely, representing:

1. **Incomplete value** - The user wanted to create something useful but never finished
2. **Mental clutter** - Old drafts accumulate and clutter the main workflow list
3. **Lost context** - After days/weeks, users may forget what they were trying to build

The app should proactively surface stale drafts to help users either complete them or clean them up, without being annoying.

## What is a "Stale Draft"?

A draft workflow is considered stale when:

- `workflow.status === ""` (Draft status)
- No chat activity for X days (configurable, default: 3 days)
- The workflow has at least one chat event (user started working on it)

**Not considered stale:**
- Active or paused workflows (they're "done")
- Brand new drafts with no activity (user hasn't started yet)
- Drafts with recent chat activity (user is actively working on them)

### Activity Detection

Activity is determined by the most recent chat event timestamp for the workflow's associated `chat_id` (same as `workflow.id`). Query the `chat_events` table for the workflow's chat and check the max timestamp.

```sql
SELECT MAX(timestamp) as last_activity
FROM chat_events
WHERE chat_id = ?
```

Compare against current time to determine staleness.

## When and Where to Show the Prompt

### Location: Main Page Banner

Show the stale drafts prompt as a **dismissible banner** on the main page, positioned:

- **Above the attention banner** (if present)
- Below the input box area
- Same visual weight as the attention banner but different color (amber/yellow vs red)

This location ensures visibility without blocking core functionality.

### Timing Rules

1. **Check on main page load** - Calculate stale drafts when MainPage component mounts
2. **Don't re-show if dismissed** - Track dismissal timestamp in localStorage
3. **Re-surface after cooldown** - If dismissed, re-check after 7 days
4. **Don't show during active work** - If user has interacted with any draft in last 24 hours, suppress the prompt

### Frequency Control

To avoid annoying users:

| Scenario | Behavior |
|----------|----------|
| User dismisses prompt | Hide for 7 days |
| User clicks "Continue" on a draft | Suppress for 24 hours |
| User archives/deletes drafts | Immediately recalculate |
| Stale count changes | Show again (after cooldown) |

Store in localStorage:
```typescript
{
  lastDismissedAt: string | null;  // ISO timestamp
  lastInteractionAt: string | null;  // ISO timestamp
}
```

## UI Design

### Banner Component

```
Layout:
+-------------------------------------------------------------+
| You have 3 drafts waiting - want to continue?               |
|                                      [View drafts] [Dismiss]|
+-------------------------------------------------------------+
```

**Visual styling:**
- Background: `bg-amber-50` with `border-amber-200`
- Icon: `FileEdit` or `Clock` from lucide-react in `text-amber-600`
- Text: `text-amber-700` for primary, `text-amber-600` for secondary
- Matches existing attention banner structure but distinct color

**Grammar handling:**
- 1 draft: "You have 1 draft waiting - want to continue?"
- N drafts: "You have N drafts waiting - want to continue?"

### Actions

1. **"View drafts"** (primary action)
   - Filter the workflow list to show only stale drafts
   - Similar to clicking the attention banner (sets `showStaleDraftsOnly` state)
   - Banner changes to "Showing X stale drafts - click to show all"

2. **"Dismiss"** (secondary action)
   - Hides the banner
   - Records `lastDismissedAt` in localStorage
   - Does not delete or archive the drafts

3. **Click individual draft** (from filtered list)
   - Navigate to `/workflows/{id}` as usual
   - Records `lastInteractionAt` to suppress future prompts temporarily

### Filtered State

When "View drafts" is clicked:

```
+-------------------------------------------------------------+
| Showing 3 stale drafts - click to show all                  |
+-------------------------------------------------------------+
| Email summary helper        Draft   |
|   Last activity: 5 days ago         |
| Invoice processor setup     Draft   |
|   Last activity: 2 weeks ago        |
| Weekly report generator     Draft   |
|   Last activity: 8 days ago         |
+-------------------------------------------------------------+
```

**Secondary line for stale drafts:**
- Show "Last activity: X days ago" instead of the normal secondary text
- Helps user remember when they last worked on it

## Relationship to Other Features

### Detect Abandoned Drafts (sibling feature)

This spec focuses on **prompting the user**. The "Detect Abandoned Drafts" feature (also in IMPLEMENTATION_PLAN.md) is about:

- Identifying which drafts are abandoned (the detection logic)
- Potentially auto-archiving very old drafts

This spec uses the detection logic but focuses on the **user-facing prompt**.

### Archive Old Drafts (future feature)

A future enhancement could add:
- "Archive all" button in the stale drafts prompt
- Auto-archive drafts older than 30 days
- Archived drafts move to a separate "Archived" section

This spec does NOT implement archiving - it only prompts the user.

### Attention Banner

The attention banner (red, for failed/waiting workflows) takes priority over the stale drafts banner. Both can be visible simultaneously. Order from top to bottom:

1. Stale drafts banner (amber) - informational
2. Attention banner (red) - action required

## Implementation Approach

### 1. Add Stale Draft Detection Hook

Create `/apps/web/src/hooks/useStaleDrafts.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useWorkflows } from './dbScriptReads';
import { useDbQuery } from './dbQuery';
import type { Workflow } from '@app/db';

const STALE_DAYS_THRESHOLD = 3;
const DISMISS_COOLDOWN_DAYS = 7;
const INTERACTION_COOLDOWN_HOURS = 24;
const STORAGE_KEY = 'keep-ai-stale-drafts-prompt';

interface StaleDraftsState {
  lastDismissedAt: string | null;
  lastInteractionAt: string | null;
}

export function useStaleDrafts() {
  const { data: workflows = [] } = useWorkflows();
  const { api } = useDbQuery();
  const [staleDrafts, setStaleDrafts] = useState<(Workflow & { lastActivity: Date })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!api || workflows.length === 0) {
      setIsLoading(false);
      return;
    }

    const calculateStaleDrafts = async () => {
      const drafts = workflows.filter(w => w.status === '');
      const now = new Date();
      const staleThreshold = new Date(now.getTime() - STALE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000);

      const draftsWithActivity: (Workflow & { lastActivity: Date })[] = [];

      for (const draft of drafts) {
        const lastActivity = await api.chatStore.getLastChatActivity(draft.id);
        if (lastActivity && lastActivity < staleThreshold) {
          draftsWithActivity.push({ ...draft, lastActivity });
        }
      }

      setStaleDrafts(draftsWithActivity);
      setIsLoading(false);

      // Check if we should show the prompt
      const state = loadState();
      const shouldShow = checkShouldShowPrompt(state, draftsWithActivity.length);
      setShowPrompt(shouldShow);
    };

    calculateStaleDrafts();
  }, [api, workflows]);

  const dismissPrompt = useCallback(() => {
    const state: StaleDraftsState = {
      ...loadState(),
      lastDismissedAt: new Date().toISOString(),
    };
    saveState(state);
    setShowPrompt(false);
  }, []);

  const recordInteraction = useCallback(() => {
    const state: StaleDraftsState = {
      ...loadState(),
      lastInteractionAt: new Date().toISOString(),
    };
    saveState(state);
    setShowPrompt(false);
  }, []);

  return {
    staleDrafts,
    staleCount: staleDrafts.length,
    showPrompt,
    dismissPrompt,
    recordInteraction,
    isLoading,
  };
}

function loadState(): StaleDraftsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { lastDismissedAt: null, lastInteractionAt: null };
}

function saveState(state: StaleDraftsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function checkShouldShowPrompt(state: StaleDraftsState, staleCount: number): boolean {
  if (staleCount === 0) return false;

  const now = new Date();

  // Check dismiss cooldown
  if (state.lastDismissedAt) {
    const dismissedAt = new Date(state.lastDismissedAt);
    const cooldownEnd = new Date(dismissedAt.getTime() + DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    if (now < cooldownEnd) return false;
  }

  // Check interaction cooldown
  if (state.lastInteractionAt) {
    const interactedAt = new Date(state.lastInteractionAt);
    const cooldownEnd = new Date(interactedAt.getTime() + INTERACTION_COOLDOWN_HOURS * 60 * 60 * 1000);
    if (now < cooldownEnd) return false;
  }

  return true;
}
```

### 2. Add Database Method

Add to `/packages/db/src/chat-store.ts`:

```typescript
async getLastChatActivity(chatId: string): Promise<Date | null> {
  const results = await this.db.db.execO<{ max_ts: string }>(
    `SELECT MAX(timestamp) as max_ts
     FROM chat_events
     WHERE chat_id = ?`,
    [chatId]
  );
  if (!results || results.length === 0 || !results[0].max_ts) return null;
  return new Date(results[0].max_ts);
}
```

### 3. Create StaleDraftsBanner Component

Create `/apps/web/src/components/StaleDraftsBanner.tsx`:

```typescript
import { FileEdit } from 'lucide-react';

interface StaleDraftsBannerProps {
  count: number;
  onViewDrafts: () => void;
  onDismiss: () => void;
  isFiltered: boolean;
  onClearFilter: () => void;
}

export function StaleDraftsBanner({
  count,
  onViewDrafts,
  onDismiss,
  isFiltered,
  onClearFilter,
}: StaleDraftsBannerProps) {
  if (isFiltered) {
    return (
      <button
        onClick={onClearFilter}
        className="w-full mb-6 p-3 rounded-lg border bg-amber-100 border-amber-300 text-amber-800 flex items-center gap-2 transition-colors hover:bg-amber-200"
      >
        <FileEdit className="h-5 w-5" />
        <span className="font-medium">
          Showing {count} stale {count === 1 ? 'draft' : 'drafts'}
        </span>
        <span className="ml-auto text-sm">Click to show all</span>
      </button>
    );
  }

  return (
    <div className="w-full mb-6 p-3 rounded-lg border bg-amber-50 border-amber-200 flex items-center gap-2">
      <FileEdit className="h-5 w-5 text-amber-600" />
      <span className="text-amber-700 flex-1">
        You have {count} {count === 1 ? 'draft' : 'drafts'} waiting - want to continue?
      </span>
      <button
        onClick={onViewDrafts}
        className="text-amber-800 hover:text-amber-900 font-medium text-sm px-2 py-1 rounded hover:bg-amber-100 transition-colors"
      >
        View drafts
      </button>
      <button
        onClick={onDismiss}
        className="text-amber-600 hover:text-amber-700 text-sm px-2 py-1 rounded hover:bg-amber-100 transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}
```

### 4. Update MainPage.tsx

Add the stale drafts banner and filtering state:

```typescript
// Add imports
import { useStaleDrafts } from '../hooks/useStaleDrafts';
import { StaleDraftsBanner } from './StaleDraftsBanner';

// Inside MainPage component
const { staleDrafts, staleCount, showPrompt, dismissPrompt, recordInteraction } = useStaleDrafts();
const [showStaleDraftsOnly, setShowStaleDraftsOnly] = useState(false);

// Filter workflows when showing stale drafts
const displayedWorkflows = showStaleDraftsOnly
  ? sortedWorkflows.filter(w => staleDrafts.some(sd => sd.id === w.id))
  : showAttentionOnly
    ? sortedWorkflows.filter(w => w.needsAttention)
    : sortedWorkflows;

// In render, before attention banner:
{showPrompt && staleCount > 0 && !showAttentionOnly && (
  <StaleDraftsBanner
    count={staleCount}
    onViewDrafts={() => {
      setShowStaleDraftsOnly(true);
      recordInteraction();
    }}
    onDismiss={dismissPrompt}
    isFiltered={showStaleDraftsOnly}
    onClearFilter={() => setShowStaleDraftsOnly(false)}
  />
)}
```

## Configuration

For v1, hardcode these values:

| Setting | Value | Description |
|---------|-------|-------------|
| `STALE_DAYS_THRESHOLD` | 3 | Days of inactivity before a draft is "stale" |
| `DISMISS_COOLDOWN_DAYS` | 7 | Days before re-showing after dismiss |
| `INTERACTION_COOLDOWN_HOURS` | 24 | Hours to suppress after interacting with a draft |

## Edge Cases

1. **No drafts exist** - Don't show the banner
2. **All drafts have recent activity** - Don't show the banner
3. **User dismisses, then creates new stale draft** - Show banner after cooldown expires
4. **Multiple browser tabs** - localStorage syncs, all tabs see same dismiss state
5. **Serverless mode** - Works the same, localStorage is per-device

## Success Metrics

- Users who see the prompt should complete or clean up drafts more often
- Track (if analytics added): prompt impressions, "View drafts" clicks, drafts completed after prompt
- Reduced average number of stale drafts per user over time

## Future Enhancements

1. **Archive action** - "Archive all" button to bulk-archive stale drafts
2. **Per-draft dismiss** - Dismiss individual drafts from the prompt
3. **Smart timing** - Show prompt at optimal times (e.g., first app open of the day)
4. **Push notification** - Optional push notification for very stale drafts (30+ days)
