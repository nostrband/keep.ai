// Database factory functions for createDB/closeDB pattern
import { DBInterface } from "./interfaces";
import debug from "debug";
import { migrateV1 } from "./migrations/v1";
import { migrateV2 } from "./migrations/v2";
import { migrateV3 } from "./migrations/v3";
import { migrateV4 } from "./migrations/v4";
import { migrateV5 } from "./migrations/v5";
import { migrateV6 } from "./migrations/v6";
import { migrateV7 } from "./migrations/v7";
import { migrateV8 } from "./migrations/v8";
import { migrateV9 } from "./migrations/v9";
import { migrateV10 } from "./migrations/v10";
import { migrateV11 } from "./migrations/v11";
import { migrateV12 } from "./migrations/v12";
import { migrateV13 } from "./migrations/v13";

const debugDatabase = debug("db:database");

export interface CRSqliteDB {
  start(): Promise<void>;
  close(): Promise<void>;
  get db(): DBInterface;
}

export class KeepDb implements CRSqliteDB {
  private db_instance: DBInterface;
  private started: boolean = false;

  constructor(dbInstance: DBInterface) {
    this.db_instance = dbInstance;
  }

  get db(): DBInterface {
    return this.db_instance;
  }

  async start(): Promise<void> {
    if (this.started) {
      debugDatabase("Database already initialized");
      return;
    }

    await this.initialize();
  }

  async close() {
    try {
      if (this.db_instance) {
        await this.db_instance.close();
        debugDatabase("Database closed successfully");
      }
    } catch (error) {
      debugDatabase("Failed to close database:", error);
      throw error;
    }
  }

  private async initialize() {
    const db = this.db;

    // Migration system
    const migrations = new Map([
      [1, migrateV1],
      [2, migrateV2],
      [3, migrateV3],
      [4, migrateV4],
      [5, migrateV5],
      [6, migrateV6],
      [7, migrateV7],
      [8, migrateV8],
      [9, migrateV9],
      [10, migrateV10],
      [11, migrateV11],
      [12, migrateV12],
      [13, migrateV13],
    ]);

    const readVersion = async () => {
      const result = await db.execO<{ user_version: number }>(
        "PRAGMA user_version"
      );
      return result?.length ? Number(result[0].user_version) || 0 : 0;
    };

    // Get current database version
    const currentVersion = await readVersion();

    debugDatabase(`Current database version: ${currentVersion}`);

    // Apply migrations starting from current version + 1
    const maxVersion = Math.max(...migrations.keys());
    if (currentVersion > maxVersion) {
      throw new Error(
        `DB is newer than our code, db version ${currentVersion}, code version ${maxVersion}`
      );
    }

    for (let version = currentVersion + 1; version <= maxVersion; version++) {
      const migrationFn = migrations.get(version);
      if (!migrationFn) {
        throw new Error(`Migration function for version ${version} not found`);
      }

      debugDatabase(`Applying migration v${version}...`);

      try {
        await db.tx(async (tx) => {
          await migrationFn(tx);
        });

        // Verify the version was set correctly
        const newVersion = await readVersion();

        if (newVersion !== version) {
          throw new Error(
            `Migration v${version} failed: expected version ${version}, got ${newVersion}`
          );
        }

        // NOTE: we'll remove this after prototyping
        // is over and we've figured out the final db structure
        // and collapsed all migrations
        if (newVersion === 7) {
          // Import all records from crsql_changes in batches of 5000
          // First count total records to know how many batches we need
          const countResult = await db.execO<{ total: number }>(
            `SELECT COUNT(*) as total FROM crsql_changes`
          );

          const totalRecords =
            countResult && countResult.length > 0 ? countResult[0].total : 0;

          if (totalRecords > 0) {
            const batchSize = 5000;
            const totalBatches = Math.ceil(totalRecords / batchSize);

            for (let batch = 0; batch < totalBatches; batch++) {
              const offset = batch * batchSize;

              await db.exec(
                `INSERT INTO crsql_change_history (\`table\`, pk, cid, val, col_version, db_version, site_id, cl, seq)
         SELECT \`table\`, pk, cid, val, col_version, db_version, site_id, cl, seq
         FROM crsql_changes LIMIT ? OFFSET ?`,
                [batchSize, offset]
              );
            }
          }
        }

        debugDatabase(`Migration v${version} applied successfully`);
      } catch (error) {
        debugDatabase(`Migration v${version} failed:`, error);
        throw error;
      }
    }

    if (currentVersion === maxVersion) {
      debugDatabase("Database is up to date");
    } else {
      debugDatabase(
        `Database migrated from version ${currentVersion} to ${maxVersion}`
      );
    }

    this.started = true;
  }
}
