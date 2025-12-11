import { DBInterface } from "../interfaces";

export async function migrateV10(tx: DBInterface["tx"] extends (fn: (tx: infer T) => any) => any ? T : never) {

  // VERSION: 10
  await tx.exec(`PRAGMA user_version = 10`);

  // Create files table
  await tx.exec(`CREATE TABLE files (
    id text not null primary key,
    name text not null default '',
    path text not null default '',
    summary text not null default '',
    upload_time text not null default '',
    media_type text not null default '',
    size int not null default 0
  )`);

  // Add the table to CRR for conflict-free replication
  await tx.exec(`SELECT crsql_as_crr('files')`);

  // Create indexes for performance
  await tx.exec(`CREATE INDEX idx_files_path ON files(path)`);
  await tx.exec(`CREATE INDEX idx_files_upload_time ON files(upload_time)`);
  await tx.exec(`CREATE INDEX idx_files_media_type ON files(media_type)`);
}