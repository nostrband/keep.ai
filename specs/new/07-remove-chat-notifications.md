# Spec 07: Remove chat_notifications Feature

## Overview

Remove all code related to the `chat_notifications` table. This feature implemented per-device notification tracking for a chat-centric UX that doesn't align with our v1 workflow-focused product.

**Rationale:** Keep.AI is not a chat app. The complexity of per-device notification tracking is unnecessary for v1 and likely forever. The workflow-centric notifications page (Spec 03) handles user notifications differently.

## Scope

- **Remove:** All code that queries/updates the `chat_notifications` table
- **Keep:** The table in the database, marked as deprecated (drop later near production)
- **Keep:** The migration file (required for existing databases)

## Files to Modify

### 1. Database Migration - Mark as Deprecated

**File:** `packages/db/src/migrations/v23.ts`

Add a deprecation comment at the top of the migration:

```typescript
/**
 * DEPRECATED: This migration creates the chat_notifications table which is no longer used.
 * The table is kept for backwards compatibility with existing databases but all
 * application code has been removed. Will be dropped in a future migration.
 *
 * Original purpose: Per-device notification tracking for multi-device chat sync.
 * Removal reason: App is workflow-focused, not chat-focused. See Spec 07.
 */
```

### 2. Chat Store - Remove Methods

**File:** `packages/db/src/chat-store.ts`

Remove the following methods entirely:

1. **`markChatNotifiedOnDevice()`** (Lines ~340-352)
   - Marks a chat as notified on current device
   - No longer needed

2. **`getChatNotifiedAt()`** (Lines ~361-373)
   - Gets last notification timestamp for a chat on a device
   - No longer needed

Also remove the comment block above these methods (Lines ~328-329):
```typescript
// Per-device notification tracking methods
// These use the local chat_notifications table...
```

### 3. API Layer - Remove Methods

**File:** `packages/db/src/api.ts`

Remove the following methods:

1. **`getDeviceId()`** (Lines ~116-124)
   - Returns cr-sqlite site_id as hex string
   - Only used for chat_notifications feature
   - Remove entirely

2. **`getNewAssistantMessagesForDevice()`** (Lines ~157-194)
   - Queries messages with LEFT JOIN to chat_notifications
   - Remove entirely

**Keep:** The deprecated `getNewAssistantMessages()` method (Lines ~127-155) can remain as-is since it's already marked deprecated.

### 4. Message Notifications Library - Simplify or Remove

**File:** `apps/web/src/lib/MessageNotifications.ts`

This entire class is built around the per-device notification feature. Options:

**Option A (Recommended): Remove the entire file**
- Delete `MessageNotifications.ts`
- Remove import/usage from `queryClient.ts`

**Option B: Simplify to use deprecated method**
- Remove `deviceId` property
- Replace `getNewAssistantMessagesForDevice()` with `getNewAssistantMessages()`
- Remove `markChatNotifiedOnDevice()` call
- Remove `notifyTablesChanged(["chat_notifications"])` call

### 5. Query Client - Remove Notification Integration

**File:** `apps/web/src/queryClient.ts`

Remove:
- Import of `MessageNotifications` (if removing the file)
- Any `messageNotifications.checkNewMessages()` calls
- Any references to `chat_notifications` table in invalidation logic

## Implementation Checklist

- [ ] Add deprecation comment to `v23.ts` migration
- [ ] Remove `markChatNotifiedOnDevice()` from `chat-store.ts`
- [ ] Remove `getChatNotifiedAt()` from `chat-store.ts`
- [ ] Remove per-device notification comment block from `chat-store.ts`
- [ ] Remove `getDeviceId()` from `api.ts`
- [ ] Remove `getNewAssistantMessagesForDevice()` from `api.ts`
- [ ] Remove or simplify `MessageNotifications.ts`
- [ ] Update `queryClient.ts` to remove notification integration
- [ ] Run TypeScript build to verify no type errors
- [ ] Test that app starts and functions without errors

## Testing

1. App should start without errors
2. Existing chats should still display correctly
3. No console errors related to missing methods
4. Database migrations should still run on fresh install

## Future Work

When closer to production, create a migration to:
```sql
DROP TABLE IF EXISTS chat_notifications;
```

## Notes

- The `chat_notifications` table is LOCAL (not synced via cr-sqlite), so dropping it won't affect sync
- No tests exist for this functionality, so no test updates needed
- The feature was added in v23 migration and never fully utilized in production
