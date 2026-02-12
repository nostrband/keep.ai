import { DBInterface } from "../interfaces";

/**
 * Migration v34: Update script versioning schema for maintainer task type
 *
 * Changes:
 * - Rename `version` column to `major_version`
 * - Add `minor_version` column with default 0
 *
 * This enables the planner/maintainer split:
 * - Planner increments major_version and resets minor_version to 0
 * - Maintainer increments minor_version while preserving major_version
 *
 * Example version progression:
 * - Planner creates: 1.0, 2.0, 3.0
 * - Maintainer fixes 2.0: 2.1, 2.2
 * - Planner updates: 3.0 (planner takes precedence)
 *
 * See specs/maintainer-task-type.md for design details.
 */
export async function migrateV34(
  tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never
) {
  // VERSION: 34
  await tx.exec(`PRAGMA user_version = 34`);

  // Begin CRSQLite alter mode for scripts table
  await tx.exec("SELECT crsql_begin_alter('scripts')");

  // Rename version to major_version
  await tx.exec(`ALTER TABLE scripts RENAME COLUMN version TO major_version`);

  // Add minor_version column with default 0
  // CRSQLite requires NOT NULL columns to have DEFAULT values
  await tx.exec(
    `ALTER TABLE scripts ADD COLUMN minor_version INTEGER NOT NULL DEFAULT 0`
  );

  // Commit CRSQLite alter
  await tx.exec("SELECT crsql_commit_alter('scripts')");

  // Update index for version queries (replace old version index with new composite)
  // Note: The old index idx_scripts_version will automatically use major_version after rename
  // Add a new composite index for efficient major+minor ordering
  await tx.exec(
    `CREATE INDEX IF NOT EXISTS idx_scripts_major_minor_version ON scripts(major_version DESC, minor_version DESC)`
  );

  // Update records in crsql_change_history table
  await tx.exec(
    "UPDATE crsql_change_history SET cid='major_version' WHERE `table`='scripts' AND cid='version'"
  );

}
