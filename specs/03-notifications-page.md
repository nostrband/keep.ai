# Spec 03: Notifications Page

## Overview

Create a `/notifications` page that displays **actionable items only** - things that require user attention or response. No "All events" timeline (too messy at scale with parallel workflows).

## Routes

| Route | Description |
|-------|-------------|
| `/notifications` | All actionable items from all workflows |
| `/notifications/{workflowId}` | Actionable items for specific workflow |

## What Shows Here

**Actionable items only:**
- ⚠️ **Errors** - auth expired, permission denied, network failures (after retries), escalated auto-fix
- 📬 **Script messages** - `user-send` notifications from running scripts
- ❓ **Script confirmations** (future) - `user-ask` requests from scripts needing user approval

**NOT shown here:**
- Successful runs (shown on workflow page)
- Auto-fix activity (shown in chat page)
- Tool execution logs (internal)
- Regular chat messages (shown in chat page)

## Page Layout

```
┌──────────────────────────────────────────────────────┐
│ ← Home                    Notifications    🔔   [≡]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ ⚠️ Authentication expired                       │ │
│  │    Gmail token needs refresh                    │ │
│  │    Check Gmail for newsletters · 2 hours ago   │ │
│  │    [Reconnect Gmail]  [View workflow →]        │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ ⛔ Automation paused - needs your help          │ │
│  │    AI tried 3x but couldn't fix date parsing    │ │
│  │    Daily report · 1 hour ago                   │ │
│  │    [View workflow →]                           │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ 📬 Backup completed                             │ │
│  │    Backed up 47 photos to Google Drive         │ │
│  │    Photo backup · 3 hours ago                  │ │
│  │    [View workflow →]                           │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ ❓ Confirm deletion (future user-ask)          │ │
│  │    Delete 12 old files from Downloads?         │ │
│  │    Cleanup bot · just now                      │ │
│  │    [Yes] [No] [View workflow →]                │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│                    [Load more]                       │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Workflow-Specific View (`/notifications/{workflowId}`)

Linked from workflow page to see errors/notifications for that workflow only.

```
┌──────────────────────────────────────────────────────┐
│ ← Workflow          Check Gmail...         🔔   [≡]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  (Same layout, filtered to this workflow)            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Back button returns to workflow page, not /notifications.

## Notification Card Types

### Error (type='error')

```
┌────────────────────────────────────────────────────┐
│ ⚠️ {error_type_friendly} error                     │
│    {message}                                       │
│    {workflow_title} · {relative_time}              │
│    [{action_button}]  [View workflow →]            │
└────────────────────────────────────────────────────┘
```

**Action buttons by error type:**
| Error Type | Button |
|------------|--------|
| auth | "Reconnect {service}" |
| permission | "Check Permissions" |
| network | "Retry Now" |
| internal | "View Details" |

### Escalated Auto-Fix (type='escalated')

```
┌────────────────────────────────────────────────────┐
│ ⛔ Automation paused - needs your help             │
│    AI tried {fix_attempts}x but couldn't fix it    │
│    {workflow_title} · {relative_time}              │
│    [View workflow →]                               │
└────────────────────────────────────────────────────┘
```

### Script Message (type='script_message')

```
┌────────────────────────────────────────────────────┐
│ 📬 {title or first line}                           │
│    {message body truncated}                        │
│    {workflow_title} · {relative_time}              │
│    [View workflow →]                               │
└────────────────────────────────────────────────────┘
```

### Script Confirmation - Future (type='script_ask')

```
┌────────────────────────────────────────────────────┐
│ ❓ {question}                                       │
│    {context/details}                               │
│    {workflow_title} · {relative_time}              │
│    [Yes] [No] [View workflow →]                    │
└────────────────────────────────────────────────────┘
```

## Data Model

Uses the `notifications` table (defined in Spec 12).

### Notification Types

| Type | Source | Description |
|------|--------|-------------|
| `error` | system | User-facing errors (auth, permission, network, internal) |
| `escalated` | system | Auto-fix failed after max attempts |
| `script_message` | script | Script notifying user (`user.send()` tool) |
| `script_ask` | script | Script requesting confirmation (future `user.ask()` tool) |

### Query: All Notifications

```sql
SELECT * FROM notifications
ORDER BY timestamp DESC
LIMIT ?
```

### Query: Workflow Notifications

```sql
SELECT * FROM notifications
WHERE workflow_id = ?
ORDER BY timestamp DESC
LIMIT ?
```

### Query: Unresolved Only (for badge count)

```sql
SELECT * FROM notifications
WHERE resolved_at = ''
ORDER BY timestamp DESC
```

## Implementation

### 1. Create NotificationsPage Component

**File:** `apps/web/src/pages/NotificationsPage.tsx`

```tsx
export function NotificationsPage() {
  const { workflowId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, fetchNextPage, hasNextPage } = useNotifications({ workflowId });

  const notifications = data?.pages.flatMap(p => p.notifications) || [];

  const handleAction = async (notification: Notification, action: string) => {
    // Handle action button clicks (Reconnect, Retry, etc.)
    // Then resolve the notification
    await api.notificationStore.resolveNotification(notification.id);
  };

  const handleViewWorkflow = (notification: Notification) => {
    // Navigate to workflow's chat via workflow_id
    navigate(`/workflows/${notification.workflow_id}`);
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Notifications"
        onBack={() => navigate(workflowId ? `/workflows/${workflowId}` : '/')}
      />

      {notifications.length === 0 ? (
        <EmptyState />
      ) : (
        <NotificationList
          notifications={notifications}
          onAction={handleAction}
          onViewWorkflow={handleViewWorkflow}
        />
      )}

      {hasNextPage && <Button onClick={() => fetchNextPage()}>Load more</Button>}
    </div>
  );
}
```

### 2. Create NotificationCard Component

**File:** `apps/web/src/components/NotificationCard.tsx`

Renders different card styles based on notification type.

### 3. Add Routes

**File:** `apps/web/src/App.tsx`

```tsx
<Route path="/notifications" element={<NotificationsPage />} />
<Route path="/notifications/:workflowId" element={<NotificationsPage />} />
```

## Empty State

```
┌────────────────────────────────────────────────────┐
│                                                    │
│              ✓ All caught up!                      │
│                                                    │
│         No notifications requiring your            │
│                  attention.                        │
│                                                    │
└────────────────────────────────────────────────────┘
```

## Testing

1. Navigate to /notifications, verify only actionable items show
2. Navigate to /notifications/{workflowId}, verify filtering works
3. Verify action buttons work (Reconnect, Retry, etc.)
4. Verify "View workflow" navigates correctly
5. Test empty state
6. Test with multiple workflows to ensure no cross-contamination

## Dependencies

- Spec 01 (Event System Refactor) - for event types and routing

## Blocked By

- Spec 01

## Blocks

- Spec 04 (Workflow Hub) - links to /notifications/{workflowId}
