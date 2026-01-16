import { DBInterface } from "../interfaces";

export async function migrateV24(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 24
  await tx.exec(`PRAGMA user_version = 24`);

  // Add cost column to script_runs table for direct cost display.
  // Per spec 08, the UI should show cost for each script run on the
  // ScriptRunDetailPage and in WorkflowDetailPage's run list.
  //
  // Cost is stored as integer in microdollars (cost * 1,000,000) to match
  // task_runs.cost format. This allows displaying cost without querying
  // and aggregating events.
  //
  // Cost is accumulated from tool calls during script execution (tools like
  // text_generate, images_generate, etc. that use LLM APIs).
  await tx.exec(`SELECT crsql_begin_alter('script_runs')`);
  await tx.exec(`ALTER TABLE script_runs ADD COLUMN cost integer not null default 0`);
  await tx.exec(`SELECT crsql_commit_alter('script_runs')`);
}
