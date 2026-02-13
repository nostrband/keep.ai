import { DBInterface } from "../interfaces";

/**
 * Migration v47: Add handler_config to scripts table
 *
 * Stores the WorkflowConfig JSON on each script version so that
 * activateScript() can resolve handler_config from the script itself
 * when the UI activates a script without passing explicit config.
 */
export async function migrateV47(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 47
  await tx.exec(`PRAGMA user_version = 47`);

  // =========================================
  // ALTER scripts TABLE - Add handler_config column
  // =========================================

  await tx.exec("SELECT crsql_begin_alter('scripts')");

  await tx.exec(`
    ALTER TABLE scripts ADD COLUMN handler_config TEXT NOT NULL DEFAULT ''
  `);

  await tx.exec("SELECT crsql_commit_alter('scripts')");
}
