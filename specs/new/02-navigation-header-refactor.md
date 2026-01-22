# Spec 02: Navigation & Header Refactor

## Overview

Simplify the navigation menu from 10 items to a focused set, add a notification bell with badge to the header on ALL pages, and move legacy/debug pages into an "Advanced" submenu.

## Current Navigation (10 items)

```
[Menu Button]
├── Assistant      → /chat/main     (REMOVE - legacy)
├── Workflows      → /workflows
├── Tasks          → /tasks         (MOVE to Advanced)
├── Scripts        → /scripts       (MOVE to Advanced)
├── Threads        → /threads       (MOVE to Advanced)
├── Notes          → /notes         (MOVE to Advanced)
├── Files          → /files         (MOVE to Advanced)
├── Devices        → /devices       (MOVE to Advanced)
├── Console        → /console       (MOVE to Advanced)
└── Settings       → /settings
```

## Target Navigation

```
[🔔 Badge]  [Menu Button]
              ├── Home           → /
              ├── Notifications  → /notifications
              ├── Settings       → /settings
              ├── ─────────────────
              └── Advanced ▶
                    ├── Tasks     → /tasks
                    ├── Scripts   → /scripts
                    ├── Threads   → /threads
                    ├── Notes     → /notes
                    ├── Files     → /files
                    ├── Devices   → /devices
                    └── Console   → /console
```

## Header Layout (All Pages)

```
┌──────────────────────────────────────────────────────┐
│ [←]  Page Title                         🔔 2   [≡]  │
│  │      │                                │      │    │
│  │      │                                │      └── Menu button
│  │      │                                └── Notification bell with badge
│  │      └── Dynamic based on current page
│  └── Back button (when not on home)
└──────────────────────────────────────────────────────┘
```

### Header Variations by Page

| Page | Back Button | Title | Bell | Menu |
|------|-------------|-------|------|------|
| `/` (Home) | No | "Keep.AI" | Yes | Yes |
| `/workflows/{id}` | Yes → `/` | "Workflow Name" | Yes | Yes |
| `/chats/{id}` | Yes → workflow | "Chat" | Yes | Yes |
| `/notifications` | Yes → `/` | "Notifications" | Yes | Yes |
| `/settings` | Yes → `/` | "Settings" | Yes | Yes |
| Advanced pages | Yes → `/` | Page name | Yes | Yes |

## Notification Bell Component

### Visual Design

```
     ┌───┐
     │🔔│  ← Bell icon
     └───┘
       2   ← Badge (red circle with count)
       ↑
   Only shown if count > 0
```

### Badge Count Source

Query the `notifications` table for unresolved items:

```sql
SELECT COUNT(*) FROM notifications
WHERE resolved_at = ''
  AND type IN ('error', 'escalated', 'script_message', 'script_ask')
```

Counts:
- Unresolved errors (auth, permission, network)
- Escalated auto-fix failures
- Script messages awaiting acknowledgment
- NOT counting logic errors (AI handles silently via maintenance mode)

### Click Behavior

Click bell → Navigate to `/notifications`

## Implementation

### 1. Create NotificationBell Component

**File:** `apps/web/src/components/NotificationBell.tsx`

```tsx
import { useWorkflowsNeedingAttention } from '@/hooks/useWorkflowsNeedingAttention';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotificationBell() {
  const { count } = useWorkflowsNeedingAttention();

  return (
    <Link to="/notifications" className="relative">
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  );
}
```

### 2. Create useUnresolvedNotifications Hook

**File:** `apps/web/src/hooks/useUnresolvedNotifications.ts`

Query the `notifications` table directly for unresolved items:

```typescript
export function useUnresolvedNotifications() {
  const { api } = useDbQuery();

  return useQuery({
    queryKey: ['unresolvedNotifications'],
    queryFn: async () => {
      if (!api) return { count: 0, notifications: [] };
      const notifications = await api.notificationStore.getNotifications({
        unresolvedOnly: true,
      });
      return {
        count: notifications.length,
        notifications,
      };
    },
    meta: { tables: ['notifications'] },
  });
}
```

### 3. Update SharedHeader Component

**File:** `apps/web/src/components/SharedHeader.tsx` (or similar)

Add NotificationBell before the menu button:

```tsx
<header>
  {showBackButton && <BackButton />}
  <h1>{title}</h1>
  <div className="flex items-center gap-2">
    <NotificationBell />
    <MenuButton />
  </div>
</header>
```

### 4. Update Menu Component

**File:** `apps/web/src/components/Menu.tsx` (or similar)

```tsx
<Menu>
  <MenuItem to="/">Home</MenuItem>
  <MenuItem to="/notifications">Notifications</MenuItem>
  <MenuItem to="/settings">Settings</MenuItem>
  <MenuSeparator />
  <SubMenu label="Advanced">
    <MenuItem to="/tasks">Tasks</MenuItem>
    <MenuItem to="/scripts">Scripts</MenuItem>
    <MenuItem to="/threads">Threads</MenuItem>
    <MenuItem to="/notes">Notes</MenuItem>
    <MenuItem to="/files">Files</MenuItem>
    <MenuItem to="/devices">Devices</MenuItem>
    <MenuItem to="/console">Console</MenuItem>
  </SubMenu>
</Menu>
```

### 5. Remove /chat/main Route

**File:** `apps/web/src/App.tsx` (or router config)

Remove the route for `/chat/main`. If users navigate there directly, redirect to `/`.

```tsx
// Remove:
<Route path="/chat/main" element={<ChatPage />} />

// Add redirect if needed:
<Route path="/chat/main" element={<Navigate to="/" replace />} />
```

## Page Tree (After Refactor)

```
/                           Home (workflow list + create)
├── /workflows/{id}         Workflow Hub
│   └── /chats/{id}         Chat (within workflow context)
├── /notifications          Global Event Feed
│   └── /notifications/{id} Workflow Event Feed (filtered)
├── /settings               Settings
│
└── [Advanced]
    ├── /tasks              Task list (debug)
    ├── /tasks/{id}         Task detail (debug)
    ├── /scripts            Script list (debug)
    ├── /threads            Thread list (debug)
    ├── /notes              Notes (debug)
    ├── /files              Files (debug)
    ├── /devices            Devices (debug)
    └── /console            SQL Console (debug)
```

## Testing

1. Verify bell appears on all pages (home, workflow, chat, settings, advanced)
2. Verify badge count matches workflows needing attention
3. Verify clicking bell navigates to /notifications
4. Verify menu has correct structure with Advanced submenu
5. Verify /chat/main redirects to /
6. Verify Advanced pages still accessible and functional

## Dependencies

- None

## Blocked By

- None

## Blocks

- Spec 03 (Notifications Page) - bell links to it
