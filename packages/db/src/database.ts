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
import { migrateV14 } from "./migrations/v14";
import { migrateV15 } from "./migrations/v15";
import { migrateV16 } from "./migrations/v16";
import { migrateV17 } from "./migrations/v17";
import { migrateV18 } from "./migrations/v18";
import { migrateV19 } from "./migrations/v19";
import { migrateV20 } from "./migrations/v20";
import { migrateV21 } from "./migrations/v21";
import { migrateV22 } from "./migrations/v22";
import { migrateV23 } from "./migrations/v23";
import { migrateV24 } from "./migrations/v24";
import { migrateV25 } from "./migrations/v25";
import { migrateV26 } from "./migrations/v26";
import { migrateV27 } from "./migrations/v27";
import { migrateV28 } from "./migrations/v28";
import { migrateV29 } from "./migrations/v29";
import { migrateV30 } from "./migrations/v30";
import { migrateV31 } from "./migrations/v31";
import { migrateV32 } from "./migrations/v32";
import { migrateV33 } from "./migrations/v33";
import { migrateV34 } from "./migrations/v34";
import { migrateV35 } from "./migrations/v35";
import { migrateV36 } from "./migrations/v36";
import { migrateV37 } from "./migrations/v37";
import { migrateV38 } from "./migrations/v38";
import { migrateV39 } from "./migrations/v39";
import { migrateV40 } from "./migrations/v40";
import { migrateV41 } from "./migrations/v41";
import { migrateV42 } from "./migrations/v42";
import { migrateV43 } from "./migrations/v43";
import { migrateV44 } from "./migrations/v44";

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
      [14, migrateV14],
      [15, migrateV15],
      [16, migrateV16],
      [17, migrateV17],
      [18, migrateV18],
      [19, migrateV19],
      [20, migrateV20],
      [21, migrateV21],
      [22, migrateV22],
      [23, migrateV23],
      [24, migrateV24],
      [25, migrateV25],
      [26, migrateV26],
      [27, migrateV27],
      [28, migrateV28],
      [29, migrateV29],
      [30, migrateV30],
      [31, migrateV31],
      [32, migrateV32],
      [33, migrateV33],
      [34, migrateV34],
      [35, migrateV35],
      [36, migrateV36],
      [37, migrateV37],
      [38, migrateV38],
      [39, migrateV39],
      [40, migrateV40],
      [41, migrateV41],
      [42, migrateV42],
      [43, migrateV43],
      [44, migrateV44],
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
