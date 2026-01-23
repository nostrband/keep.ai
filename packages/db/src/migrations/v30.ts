import { DBInterface } from "../interfaces";

/**
 * Migration v30: Split chat_events into Purpose-Specific Tables (Spec 12)
 *
 * Creates three new tables to replace the monolithic chat_events:
 * 1. chat_messages - User-visible conversation with optional metadata links
 * 2. notifications - Actionable items requiring user attention during workflow running
 * 3. execution_logs - Tool calls and debugging data
 *
 * This improves UX by:
 * - Chat shows clean conversation with rich links to related data
 * - Notifications are separate from the chat feed
 * - Execution details accessed via drill-down, not inline
 *
 * DEPRECATED: chat_events table is kept for backwards compatibility but no longer used.
 */
export async function migrateV30(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 30
  await tx.exec(`PRAGMA user_version = 30`);

  // 1. Create chat_messages table
  // Note: All NOT NULL columns must have DEFAULT for cr-sqlite CRR compatibility
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      task_run_id TEXT NOT NULL DEFAULT '',
      script_id TEXT NOT NULL DEFAULT '',
      failed_script_run_id TEXT NOT NULL DEFAULT ''
    )
  `);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp)`);
  await tx.exec(`SELECT crsql_as_crr('chat_messages')`);

  // 2. Create notifications table
  // Note: All NOT NULL columns must have DEFAULT for cr-sqlite CRR compatibility
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL,
      workflow_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      acknowledged_at TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      workflow_title TEXT NOT NULL DEFAULT ''
    )
  `);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_workflow_id ON notifications(workflow_id)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)`);
  await tx.exec(`SELECT crsql_as_crr('notifications')`);

  // 3. Create execution_logs table
  // Note: All NOT NULL columns must have DEFAULT for cr-sqlite CRR compatibility
  await tx.exec(`
    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL DEFAULT '',
      run_type TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL DEFAULT '',
      tool_name TEXT NOT NULL DEFAULT '',
      input TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT '',
      cost INTEGER NOT NULL DEFAULT 0
    )
  `);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_execution_logs_run_id ON execution_logs(run_id)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_execution_logs_timestamp ON execution_logs(timestamp)`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_execution_logs_run_type ON execution_logs(run_type)`);
  await tx.exec(`SELECT crsql_as_crr('execution_logs')`);

  // 4. Migrate existing messages from chat_events to chat_messages
  // Note: We preserve the original JSON content structure for backwards compatibility
  await tx.exec(`
    INSERT OR IGNORE INTO chat_messages (id, chat_id, role, content, timestamp)
    SELECT
      id,
      chat_id,
      COALESCE(json_extract(content, '$.role'), 'assistant') as role,
      content,
      timestamp
    FROM chat_events
    WHERE type = 'message'
  `);

  // 5. Migrate tool events to execution_logs
  // Note: tool events don't have run_id in the old format, we'll use a placeholder
  // Future events will have proper run_id from task-worker/workflow-worker
  await tx.exec(`
    INSERT OR IGNORE INTO execution_logs (id, run_id, run_type, event_type, tool_name, input, output, timestamp, cost)
    SELECT
      id,
      COALESCE(json_extract(content, '$.task_run_id'), '') as run_id,
      'task' as run_type,
      'tool_call' as event_type,
      type as tool_name,
      COALESCE(json_extract(content, '$.input'), '') as input,
      COALESCE(json_extract(content, '$.output'), '') as output,
      timestamp,
      COALESCE(json_extract(content, '$.usage.cost'), 0) as cost
    FROM chat_events
    WHERE type NOT IN ('message', 'task_run', 'task_run_end', 'add_script',
                       'maintenance_started', 'maintenance_fixed', 'maintenance_escalated')
  `);

  // 6. Migrate task_run markers to execution_logs
  await tx.exec(`
    INSERT OR IGNORE INTO execution_logs (id, run_id, run_type, event_type, timestamp)
    SELECT
      id,
      COALESCE(json_extract(content, '$.task_run_id'), json_extract(content, '$.id'), '') as run_id,
      'task' as run_type,
      CASE type
        WHEN 'task_run' THEN 'run_start'
        WHEN 'task_run_end' THEN 'run_end'
      END as event_type,
      timestamp
    FROM chat_events
    WHERE type IN ('task_run', 'task_run_end')
  `);
}
