import { DBInterface } from "../interfaces";

/**
 * Migration v28: Direct Chat-Workflow Linking (Spec 09)
 *
 * Adds direct links between chats and workflows:
 * - workflows.chat_id - direct link from workflow to its chat
 * - chats.workflow_id - direct link from chat to its workflow
 *
 * This simplifies navigation and removes the need to go through tasks.
 * Existing data is migrated from the task.chat_id relationship.
 */
export async function migrateV28(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 28
  await tx.exec(`PRAGMA user_version = 28`);

  // Add chat_id to workflows
  await tx.exec(`SELECT crsql_begin_alter('workflows')`);
  await tx.exec(`ALTER TABLE workflows ADD COLUMN chat_id TEXT NOT NULL DEFAULT ''`);
  await tx.exec(`SELECT crsql_commit_alter('workflows')`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_chat_id ON workflows(chat_id)`);

  // Add workflow_id to chats
  await tx.exec(`SELECT crsql_begin_alter('chats')`);
  await tx.exec(`ALTER TABLE chats ADD COLUMN workflow_id TEXT NOT NULL DEFAULT ''`);
  await tx.exec(`SELECT crsql_commit_alter('chats')`);
  await tx.exec(`CREATE INDEX IF NOT EXISTS idx_chats_workflow_id ON chats(workflow_id)`);

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
