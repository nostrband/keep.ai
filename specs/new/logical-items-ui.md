# Logical Items UI - v1

This spec covers the UI for displaying and browsing logical items on workflow pages.

**Depends on**: `logical-items.md` (items table, ItemStore)

**Scope**: Items summary box on workflow detail page, items list page with filters and search.

**Out of scope**: Per-item detail page, user actions (skip, reprocess), mutation logs, attempt history expansion.

---

## 1. Overview

Logical items are the fundamental unit of work in Keep.AI automations. Users need visibility into:

- How many items have been processed
- Which items failed or need attention
- What specific items exist (searchable by title/ID)

This UI provides observability without inviting debugging (per UX model in docs/dev/02-ux-model.md).

---

## 2. Database Changes

### 2.1 Index Addition

Add index for efficient status filtering (in same migration as items table, or new migration if table exists):

```sql
CREATE INDEX IF NOT EXISTS idx_items_workflow_status
ON items(workflow_id, status);
```

### 2.2 ItemStore Method Additions

**File**: `packages/db/src/item-store.ts`

Add `countByStatus` method (may already exist from logical-items.md spec):

```typescript
async countByStatus(workflowId: string): Promise<Record<ItemStatus, number>> {
  const rows = await db.all<{ status: ItemStatus; count: number }>(
    `SELECT status, COUNT(*) as count FROM items
     WHERE workflow_id = ? GROUP BY status`,
    [workflowId]
  );

  const result: Record<ItemStatus, number> = {
    processing: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    result[row.status] = row.count;
  }

  return result;
}
```

Add `searchItems` method:

```typescript
async searchItems(
  workflowId: string,
  options: {
    status?: ItemStatus;
    query?: string;  // searches title and logical_item_id
    limit?: number;
    offset?: number;
  }
): Promise<Item[]> {
  let sql = `SELECT * FROM items WHERE workflow_id = ?`;
  const params: any[] = [workflowId];

  if (options.status) {
    sql += ` AND status = ?`;
    params.push(options.status);
  }

  if (options.query) {
    sql += ` AND (title LIKE ? OR logical_item_id LIKE ?)`;
    const pattern = `%${options.query}%`;
    params.push(pattern, pattern);
  }

  sql += ` ORDER BY updated_at DESC`;

  if (options.limit) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
    if (options.offset) {
      sql += ` OFFSET ?`;
      params.push(options.offset);
    }
  }

  return db.all<Item>(sql, params);
}
```

---

## 3. Items Summary Box

### 3.1 Location

On `WorkflowDetailPage`, after "What This Automation Does" section, before "Chat Section".

### 3.2 Component: `ItemsSummaryBox`

**File**: `apps/web/src/components/ItemsSummaryBox.tsx`

**Props**:
```typescript
interface ItemsSummaryBoxProps {
  workflowId: string;
}
```

**Visual design**:

```
┌──────────────────────────────────────────────────────────┐
│ Items                                                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   127 done  •  3 failed  •  2 processing                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Behavior**:

- Uses `useDbQuery` to fetch `countByStatus(workflowId)` reactively
- Each status count is a clickable link to `/workflows/{id}/items?status={status}`
- Clicking the box header/title navigates to `/workflows/{id}/items` (all items)
- Status colors:
  - `done`: green (text-green-600)
  - `failed`: red (text-red-600)
  - `processing`: blue (text-blue-600)
  - `skipped`: gray (text-gray-500)
  - `needs_attention`: amber (text-amber-600) - reserved for future
- Only show statuses with count > 0
- Separate counts with bullet (•) or similar delimiter

**Empty state**:

When total items = 0, show placeholder:

```
┌──────────────────────────────────────────────────────────┐
│ Items                                                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   No items processed yet                                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Gray muted text, not clickable (or clicks to items page which shows same message).

**Styling**:

Use existing card pattern from WorkflowDetailPage:
- White background
- Border (border-gray-200)
- Rounded corners (rounded-lg)
- Padding (p-4)
- Section header style matching other sections

---

## 4. Items List Page

### 4.1 Route

**File**: `apps/web/src/App.tsx`

Add route:
```tsx
<Route path="/workflows/:id/items" element={<WorkflowItemsPage />} />
```

### 4.2 Component: `WorkflowItemsPage`

**File**: `apps/web/src/components/WorkflowItemsPage.tsx`

**URL params**:
- `status`: filter by status (optional)
- `q`: search query (optional)

Example: `/workflows/abc123/items?status=failed&q=alice`

### 4.3 Page Layout

```
┌──────────────────────────────────────────────────────────┐
│ ← Back to Workflow                                       │
│                                                          │
│ Items                                          [Search]  │
│ Workflow: "Process invoices from Gmail"                  │
├──────────────────────────────────────────────────────────┤
│ [All (133)] [Done (127)] [Failed (3)] [Processing (2)]   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ● Email from alice@example.com: "Invoice Dece..."    │ │
│ │   email:msg_abc123                                   │ │
│ │   Failed • Attempt 2 • 2 hours ago                   │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ● Email from bob@company.com: "Q4 Invoice"           │ │
│ │   email:msg_def456                                   │ │
│ │   Done • Attempt 1 • 5 hours ago                     │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ... more items ...                                       │
│                                                          │
│              [Load more]                                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 4.4 Header Section

- Back link: `← Back to Workflow` navigates to `/workflows/{id}`
- Title: "Items"
- Subtitle: Workflow title (fetched via `useWorkflow(id)`)
- Search input: text field, triggers search on Enter or debounced input (300ms)
  - Placeholder: "Search by title or ID..."
  - Updates URL param `q`

### 4.5 Filter Tabs

- Horizontal tab bar with status filters
- Each tab shows: `{Status} ({count})`
- Tabs to display (in order):
  1. All (total count)
  2. Done (green badge)
  3. Failed (red badge)
  4. Processing (blue badge)
  5. Skipped (gray badge)
- Only show tabs for statuses with count > 0 (except "All" always shown)
- Active tab has visual indicator (underline or filled background)
- Clicking tab updates URL param `status` and resets `offset` to 0

### 4.6 Item Row

**Component**: `ItemRow`

```typescript
interface ItemRowProps {
  item: Item;
}
```

**Layout**:
```
┌──────────────────────────────────────────────────────────┐
│ ● Email from alice@example.com: "Invoice Dece..."        │
│   email:msg_abc123                                       │
│   Failed • Attempt 2 • 2 hours ago                       │
└──────────────────────────────────────────────────────────┘
```

**Elements**:

1. **Status indicator**: Colored dot (●) matching status color
2. **Title**: Item title, truncated with ellipsis if > ~60 chars
   - Full title shown in tooltip on hover
3. **Logical item ID**: Smaller muted text (text-gray-500, text-sm)
   - Also truncated if very long
4. **Status line**:
   - Status badge (small, colored)
   - "Attempt {n}"
   - Relative timestamp from `updated_at` (e.g., "2 hours ago", "yesterday")
   - Separated by bullets (•)

**Styling**:
- Card style: white bg, border, rounded-lg, hover:shadow-sm
- Padding: p-3 or p-4
- Not clickable for v1 (no per-item page yet)
- Cursor: default (not pointer)

### 4.7 Pagination

- Initial load: 50 items
- "Load more" button at bottom when more items exist
- Button shows: "Load more" or "Load more ({remaining} remaining)" if known
- Clicking loads next 50 items, appends to list
- Hide button when no more items

### 4.8 Empty States

**No items at all** (workflow never processed anything):
```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                    📦                                    │
│                                                          │
│           No items processed yet                         │
│                                                          │
│   Items will appear here once the workflow runs          │
│   and processes data.                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**No items matching filter**:
```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│           No failed items                                │
│                                                          │
│   All items completed successfully or are still          │
│   processing.                                            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**No items matching search**:
```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│           No items found for "alice"                     │
│                                                          │
│   Try a different search term.                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 4.9 Loading State

- Show skeleton cards while loading
- 3-5 skeleton rows with animated pulse
- Filter tabs show counts as "..." while loading

---

## 5. Hooks

### 5.1 useItemCounts

**File**: `apps/web/src/hooks/dbItemReads.ts`

```typescript
export function useItemCounts(workflowId: string) {
  return useDbQuery(
    (api) => api.itemStore.countByStatus(workflowId),
    [workflowId]
  );
}
```

### 5.2 useItems

```typescript
export function useItems(
  workflowId: string,
  options: {
    status?: ItemStatus;
    query?: string;
    limit?: number;
    offset?: number;
  }
) {
  return useDbQuery(
    (api) => api.itemStore.searchItems(workflowId, options),
    [workflowId, options.status, options.query, options.limit, options.offset]
  );
}
```

---

## 6. Integration with WorkflowDetailPage

**File**: `apps/web/src/components/WorkflowDetailPage.tsx`

Add ItemsSummaryBox after "What This Automation Does" section:

```tsx
{/* Items Summary */}
<ItemsSummaryBox workflowId={workflow.id} />
```

Import and render conditionally (always show - empty state handled by component).

---

## 7. File Changes Summary

| File | Change |
|------|--------|
| `packages/db/src/item-store.ts` | Add `searchItems()` method |
| `packages/db/src/migrations/v34.ts` | Add `idx_items_workflow_status` index (if not present) |
| `apps/web/src/App.tsx` | Add route `/workflows/:id/items` |
| `apps/web/src/components/ItemsSummaryBox.tsx` | NEW - summary box component |
| `apps/web/src/components/WorkflowItemsPage.tsx` | NEW - items list page |
| `apps/web/src/components/ItemRow.tsx` | NEW - item row component |
| `apps/web/src/components/WorkflowDetailPage.tsx` | Add ItemsSummaryBox |
| `apps/web/src/hooks/dbItemReads.ts` | NEW - useItemCounts, useItems hooks |

---

## 8. Future Considerations (Out of Scope)

These are explicitly deferred to later specs:

1. **Per-item detail page** (`/workflows/{id}/items/{itemId}`)
   - Will show attempt history, mutation logs
   - Depends on mutation ledger (Chapter 13-14)

2. **User actions on items**
   - Skip, reprocess, "it didn't happen"
   - Depends on reconciliation UI

3. **Workflow list item counts**
   - Small indicator on workflow cards in list view
   - Nice to have, not critical for v1

4. **Bulk actions**
   - Select multiple items, bulk skip/reprocess
   - Future enhancement

5. **Real-time processing indicator**
   - Animated/pulsing indicator for `processing` items
   - Live log streaming for active item
