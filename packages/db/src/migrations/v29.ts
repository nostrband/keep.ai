import { DBInterface } from "../interfaces";

/**
 * Migration v29: Data Migration for Direct Chat-Workflow Linking
 *
 * Populates the columns added in v28:
 * - workflows.chat_id - from task.chat_id relationship
 * - chats.workflow_id - from workflows.chat_id relationship
 *
 * Split from v28 because cr-sqlite requires ALTER TABLE to be committed
 * before UPDATE can operate on the new columns.
 */
export async function migrateV29(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 29
  await tx.exec(`PRAGMA user_version = 29`);

  // Populate workflow.chat_id from task.chat_id
  await tx.exec(`
    UPDATE workflows
    SET chat_id = (
      SELECT t.chat_id
      FROM tasks t
      WHERE t.id = workflows.task_id
    )
    WHERE chat_id = ''
  `);

  // Populate chats.workflow_id from workflows.chat_id
  await tx.exec(`
    UPDATE chats
    SET workflow_id = (
      SELECT w.id
      FROM workflows w
      WHERE w.chat_id = chats.id
    )
    WHERE workflow_id = ''
  `);
}
