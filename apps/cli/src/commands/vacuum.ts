import { Command } from "commander";
import { createDBNode, getCurrentUser, getDBPath } from "@app/node";
import { DBInterface } from "@app/db";
import * as path from "path";
import * as fs from "fs";
import debug from "debug";

const debugVacuum = debug("cli:vacuum");
const BATCH_SIZE = 1000; // Number of rows to copy at a time

interface TableInfo {
  name: string;
  sql: string;
}

interface IndexInfo {
  name: string;
  sql: string;
  tbl_name: string;
}

export function registerVacuumCommand(program: Command): void {
  program
    .command("vacuum")
    .description("Vacuum database by copying data to a new clean database")
    .option(
      "-i, --input <path>",
      "Input database file path (defaults to current user database)"
    )
    .option(
      "-o, --output <path>",
      'Output database file path (defaults to input + "-vacuumed")'
    )
    .action(async (options) => {
      await runVacuumCommand(options);
    });
}

async function runVacuumCommand(options: {
  input?: string;
  output?: string;
}): Promise<void> {
  let oldDB: DBInterface | null = null;
  let newDB: DBInterface | null = null;
  let outputPath: string = "";

  try {
    console.log("🧹 Starting database vacuum process...");

    // Determine input database path
    let inputPath: string;
    if (options.input) {
      inputPath = path.resolve(options.input);
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input database file not found: ${inputPath}`);
      }
    } else {
      const pubkey = await getCurrentUser();
      inputPath = getDBPath(pubkey);
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Current user database not found: ${inputPath}`);
      }
    }

    // Determine output database path
    outputPath = options.output
      ? path.resolve(options.output)
      : inputPath.replace(/\.db$/, "-vacuumed.db");

    // Ensure output doesn't exist
    if (fs.existsSync(outputPath)) {
      throw new Error(`Output database already exists: ${outputPath}`);
    }

    console.log(`📂 Input database: ${inputPath}`);
    console.log(`📂 Output database: ${outputPath}`);

    // Connect to databases
    console.log("🔌 Connecting to input database...");
    oldDB = await createDBNode(inputPath);

    console.log("🔌 Creating output database...");
    newDB = await createDBNode(outputPath);

    // Checkpoint WAL to ensure all data is in main database file
    console.log("📝 Checkpointing WAL to ensure complete data...");
    await oldDB.exec("PRAGMA wal_checkpoint(TRUNCATE)");

    // Start transaction on old DB for consistent snapshot
    console.log("🔒 Starting read transaction for consistent snapshot...");
    await oldDB.exec("BEGIN TRANSACTION");

    try {
      // Find all tables in old database
      console.log("🔍 Finding all tables in input database...");
      const allTables = await getAllTables(oldDB);
      console.log(`📋 Found ${allTables.length} total tables`);

      // Filter tables (exclude crsqlite internal tables)
      const userTables = filterUserTables(allTables);
      console.log(
        `📋 Found ${userTables.length} user tables to copy: ${userTables
          .map((t) => t.name)
          .join(", ")}`
      );

      // Check if crsql_change_history exists and add it to tables to recreate (but not copy data from)
      const historyTable = allTables.find(
        (t) => t.name === "crsql_change_history"
      );
      const tablesToRecreate = historyTable
        ? [...userTables, historyTable]
        : userTables;

      // Get table schemas and indexes
      console.log("📐 Extracting table schemas and indexes...");
      const indexes = await getAllIndexes(
        oldDB,
        tablesToRecreate.map((t) => t.name)
      );

      // Recreate tables in new database
      console.log("🏗️  Creating tables in output database...");
      await recreateTables(newDB, tablesToRecreate);

      // Create indexes in new database
      console.log("🔗 Creating indexes in output database...");
      await recreateIndexes(newDB, indexes);

      // Copy database version (user_version pragma) from old to new database
      console.log("📋 Copying database schema version...");
      const userVersion = await getUserVersion(oldDB);
      await setUserVersion(newDB, userVersion);
      console.log(`📋 Set database version to: ${userVersion}`);

      // Find CRSQLite-tracked tables
      console.log("🔍 Identifying CRSQLite-tracked tables...");
      const trackedTables = findTrackedTables(
        allTables,
        userTables.map((t) => t.name)
      );
      console.log(
        `📋 Found ${
          trackedTables.length
        } CRSQLite-tracked tables: ${trackedTables.join(", ")}`
      );

      // Make tables CRSQLite-trackable in new database
      console.log("🔄 Enabling CRSQLite tracking for tracked tables...");
      await enableCRSQLiteTracking(newDB, trackedTables);

      // Copy all data in batches
      console.log("📋 Starting data copy process...");
      await copyAllTableData(
        oldDB,
        newDB,
        userTables.map((t) => t.name)
      );
    } finally {
      // Rollback read transaction on old DB
      console.log("🔓 Rolling back read transaction...");
      await oldDB.exec("ROLLBACK");
    }

    // Checkpoint WAL on new database to ensure clean state
    console.log("📝 Checkpointing new database for clean state...");
    await newDB.exec("PRAGMA wal_checkpoint(TRUNCATE)");

    console.log("✅ Database vacuum completed successfully!");
    console.log(`📊 Vacuumed database saved to: ${outputPath}`);
  } catch (error) {
    console.error("❌ Database vacuum failed:", error);

    // Clean up the output file if it was created but failed
    if (options.output || (options.input && fs.existsSync(outputPath))) {
      try {
        fs.unlinkSync(outputPath);
        console.log("🧹 Cleaned up partial output database file");
      } catch (cleanupError) {
        debugVacuum("Failed to cleanup output file:", cleanupError);
      }
    }

    throw error;
  } finally {
    // Close database connections
    try {
      if (oldDB) {
        console.log("🔌 Closing input database connection...");
        await oldDB.close();
      }
      if (newDB) {
        console.log("🔌 Closing output database connection...");
        await newDB.close();
      }
    } catch (closeError) {
      debugVacuum("Error closing database connections:", closeError);
    }
  }
}

async function getAllTables(db: DBInterface): Promise<TableInfo[]> {
  const tables = await db.execO<{ name: string; sql: string }>(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );

  if (!tables) return [];

  return tables.map((table) => ({
    name: table.name,
    sql: table.sql,
  }));
}

function filterUserTables(tables: TableInfo[]): TableInfo[] {
  return tables.filter((table) => {
    const name = table.name;
    // Filter out CRSQLite internal tables including crsql_change_history
    // (we'll copy it specially later from crsql_changes to avoid copying old site_ids)
    return !name.startsWith("crsql_") && !name.includes("__crsql_");
  });
}

async function getAllIndexes(
  db: DBInterface,
  tableNames: string[]
): Promise<IndexInfo[]> {
  const indexes: IndexInfo[] = [];

  for (const tableName of tableNames) {
    const tableIndexes = await db.execO<{
      name: string;
      sql: string;
      tbl_name: string;
    }>(
      "SELECT name, sql, tbl_name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name NOT LIKE 'sqlite_autoindex_%'",
      [tableName]
    );

    if (tableIndexes) {
      indexes.push(
        ...tableIndexes.map((index) => ({
          name: index.name,
          sql: index.sql,
          tbl_name: index.tbl_name,
        }))
      );
    }
  }

  return indexes;
}

async function recreateTables(
  db: DBInterface,
  tables: TableInfo[]
): Promise<void> {
  for (const table of tables) {
    if (!table.sql) {
      throw new Error(
        `No CREATE TABLE statement found for table: ${table.name}`
      );
    }

    console.log(`  🏗️  Creating table: ${table.name}`);
    debugVacuum(`Creating table ${table.name} with SQL: ${table.sql}`);
    await db.exec(table.sql);
  }
}

async function recreateIndexes(
  db: DBInterface,
  indexes: IndexInfo[]
): Promise<void> {
  for (const index of indexes) {
    if (!index.sql) {
      debugVacuum(`Skipping index ${index.name} - no CREATE INDEX statement`);
      continue;
    }

    console.log(
      `  🔗 Creating index: ${index.name} on table ${index.tbl_name}`
    );
    debugVacuum(`Creating index ${index.name} with SQL: ${index.sql}`);
    await db.exec(index.sql);
  }
}

function findTrackedTables(
  allTables: TableInfo[],
  userTableNames: string[]
): string[] {
  const trackedTables: string[] = [];
  const allTableNames = new Set(allTables.map((t) => t.name));

  for (const tableName of userTableNames) {
    const clockTableName = `${tableName}__crsql_clock`;

    if (allTableNames.has(clockTableName)) {
      trackedTables.push(tableName);
      debugVacuum(
        `Table ${tableName} is CRSQLite-tracked (found ${clockTableName})`
      );
    }
  }

  return trackedTables;
}

async function enableCRSQLiteTracking(
  db: DBInterface,
  trackedTables: string[]
): Promise<void> {
  for (const tableName of trackedTables) {
    console.log(`  🔄 Enabling CRSQLite tracking for table: ${tableName}`);
    debugVacuum(`Executing: SELECT crsql_as_crr('${tableName}')`);
    await db.exec(`SELECT crsql_as_crr('${tableName}')`);
  }
}

async function copyAllTableData(
  oldDB: DBInterface,
  newDB: DBInterface,
  tableNames: string[]
): Promise<void> {
  for (const tableName of tableNames) {
    // Drop nostr_peers and nostr_peer_cursors!
    // Otherwise we'll try to sync from them and will re-import all existing changes and
    // grow the site_id set again.
    // Also skip history - we have separate process for that below.
    if (
      tableName.startsWith("nostr_peer") ||
      tableName === "crsql_change_history" ||
      tableName === "all_peers"
    )
      continue;
    console.log(`  📋 Copying data for table: ${tableName}`);
    await copyTableData(oldDB, newDB, tableName);
  }

  // After copying all regular tables, copy from crsql_changes to crsql_change_history
  // This ensures only the current site_id is preserved in the history
  console.log("  📋 Copying crsql_changes to crsql_change_history...");
  await copyChangesToHistory(oldDB, newDB);
}

async function copyChangesToHistory(
  oldDB: DBInterface,
  newDB: DBInterface
): Promise<void> {
  // Check if crsql_change_history table exists in old database (to know if we should copy)
  const historyTableExists = await oldDB.execO<{ count: number }>(
    "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='crsql_change_history'"
  );

  if (!historyTableExists || historyTableExists[0].count === 0) {
    console.log(
      "    ℹ️  crsql_change_history table does not exist in source database, skipping"
    );
    return;
  }

  // Count total records in NEW database's crsql_changes to copy
  const countResult = await newDB.execO<{ total: number }>(
    "SELECT COUNT(*) as total FROM crsql_changes"
  );

  const totalRecords =
    countResult && countResult.length > 0 ? countResult[0].total : 0;

  if (totalRecords === 0) {
    console.log(
      "    ℹ️  No records in new database crsql_changes to copy to history"
    );
    return;
  }

  console.log(
    `    📊 Found ${totalRecords} records in new database crsql_changes to copy to history`
  );

  // Copy in batches of 5000 using INSERT...SELECT (same as database.ts)
  const batchSize = 5000;
  const totalBatches = Math.ceil(totalRecords / batchSize);

  for (let batch = 0; batch < totalBatches; batch++) {
    const offset = batch * batchSize;

    await newDB.exec(
      `INSERT INTO crsql_change_history (\`table\`, pk, cid, val, col_version, db_version, site_id, cl, seq)
       SELECT \`table\`, pk, cid, val, col_version, db_version, site_id, cl, seq
       FROM crsql_changes LIMIT ? OFFSET ?`,
      [batchSize, offset]
    );

    console.log(
      `    📋 Copied batch ${batch + 1}/${totalBatches} to crsql_change_history`
    );
  }

  console.log(
    `    ✅ Successfully copied ${totalRecords} records from new crsql_changes to crsql_change_history`
  );
}

async function copyTableData(
  oldDB: DBInterface,
  newDB: DBInterface,
  tableName: string
): Promise<void> {
  // Get total row count for progress tracking
  const countResult = await oldDB.execO<{ count: number }>(
    `SELECT COUNT(*) as count FROM "${tableName}"`
  );
  const totalRows = countResult ? countResult[0].count : 0;

  if (totalRows === 0) {
    console.log(`    ℹ️  Table ${tableName} is empty, skipping data copy`);
    return;
  }

  console.log(`    📊 Table ${tableName} contains ${totalRows} rows`);

  // Get column names for the table
  const columns = await oldDB.execO<{ name: string }>(
    `PRAGMA table_info("${tableName}")`
  );

  if (!columns || columns.length === 0) {
    throw new Error(`Could not get column information for table: ${tableName}`);
  }

  const columnNames = columns.map((col) => `"${col.name}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");

  // Copy data in batches
  let offset = 0;
  let copiedRows = 0;

  while (offset < totalRows) {
    const batchData = await oldDB.execO<any>(
      `SELECT ${columnNames} FROM "${tableName}" LIMIT ${BATCH_SIZE} OFFSET ${offset}`
    );

    if (!batchData || batchData.length === 0) {
      break;
    }

    // Prepare batch insert
    const insertSQL = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;
    const batchArgs = batchData.map((row) => Object.values(row));

    // Insert batch into new database
    await newDB.execManyArgs(insertSQL, batchArgs);

    copiedRows += batchData.length;
    offset += BATCH_SIZE;

    console.log(
      `    📋 Copied ${copiedRows}/${totalRows} rows (${Math.round(
        (copiedRows / totalRows) * 100
      )}%)`
    );
    debugVacuum(
      `Copied batch of ${batchData.length} rows for table ${tableName}`
    );
  }

  console.log(
    `    ✅ Completed copying ${copiedRows} rows for table ${tableName}`
  );
}

async function getUserVersion(db: DBInterface): Promise<number> {
  const result = await db.execO<{ user_version: number }>(
    "PRAGMA user_version"
  );
  return result && result.length > 0 ? result[0].user_version : 0;
}

async function setUserVersion(db: DBInterface, version: number): Promise<void> {
  debugVacuum(`Setting database version to: ${version}`);
  await db.exec(`PRAGMA user_version = ${version}`);
}
