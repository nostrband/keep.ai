import { DBInterface } from "../interfaces";

export async function migrateV26(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 26
  await tx.exec(`PRAGMA user_version = 26`);

  // Add active_script_id column to workflows table.
  //
  // Per spec active-script-version-pointer.md:
  // This replaces the "rollback creates a new version" pattern with a simple pointer.
  // Benefits:
  // - No duplicate script content on rollback
  // - No version number inflation
  // - No race conditions computing next version
  // - Idempotent operations (activate is just a pointer update)
  // - Better performance (direct ID lookup vs "latest" query)
  //
  // The column stores the script.id that should be executed when the workflow runs.
  // When creating a new script version, it automatically becomes the active version.
  // "Rollback" becomes "activate" - just updates the pointer to an existing script.
  await tx.exec(`SELECT crsql_begin_alter('workflows')`);
  await tx.exec(`ALTER TABLE workflows ADD COLUMN active_script_id text not null default ''`);
  await tx.exec(`SELECT crsql_commit_alter('workflows')`);

  // Backfill: Set active_script_id to the latest script for each existing workflow.
  // This ensures existing workflows continue to work after the migration.
  // Uses a correlated subquery to find the latest script (by version DESC) for each workflow.
  await tx.exec(`
    UPDATE workflows SET active_script_id = COALESCE(
      (SELECT id FROM scripts
       WHERE scripts.workflow_id = workflows.id
       ORDER BY version DESC
       LIMIT 1),
      ''
    )
    WHERE active_script_id = ''
  `);
}
