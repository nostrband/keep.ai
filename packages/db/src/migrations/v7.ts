import { DBInterface } from "../interfaces";

export async function migrateV7(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 7
  await tx.exec(`PRAGMA user_version = 7`);

  // Create crsql_change_history table
  await tx.exec(`CREATE TABLE crsql_change_history (
    id integer primary key autoincrement,
    \`table\` text not null,
    pk blob not null,
    cid text not null,
    val blob,
    col_version int not null,
    db_version not null,
    site_id blob not null,
    cl int not null,
    seq int not null
  )`);

  // Add index on (site_id, db_version)
  await tx.exec(`CREATE INDEX idx_crsql_change_history_site_db_version 
    ON crsql_change_history(site_id, db_version)`);

  // Note: This table is NOT tracked by cr-sqlite (no crsql_as_crr call)
  // This is intentional as specified in the requirements
}