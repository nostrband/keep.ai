import { DBInterface } from "../interfaces";

export async function migrateV8(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 8
  await tx.exec(`PRAGMA user_version = 8`);

  // Keep crsql_change_history table from v7 for performance
  // Create new all_peers table, local-only - no crr tracking
  await tx.exec(`CREATE TABLE all_peers (
    site_id blob not null primary key,
    db_version int not null
  )`);

  // Fill all_peers table with data from crsql_changes
  // Get the max db_version for each site_id
  await tx.exec(`INSERT INTO all_peers (site_id, db_version)
    SELECT site_id, MAX(db_version) as db_version 
    FROM crsql_changes 
    GROUP BY site_id`);

  // Note: This table is NOT tracked by cr-sqlite (no crsql_as_crr call)
  // This is intentional as specified in the requirements
}