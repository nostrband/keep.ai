// Database factory functions for createDB/closeDB pattern
import { DBInterface } from "./interfaces";
import debug from "debug";
import { migrateV1 } from "./migrations/v1";
import { migrateV2 } from "./migrations/v2";

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
    ]);

    const readVersion = async () => {
      const result = await db.execO<{ user_version: number }>("PRAGMA user_version");
      return result?.length ? Number(result[0].user_version) || 0 : 0;
    };

    // Get current database version
    const currentVersion = await readVersion();
    
    debugDatabase(`Current database version: ${currentVersion}`);

    // Apply migrations starting from current version + 1
    const maxVersion = Math.max(...migrations.keys());
    
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
          throw new Error(`Migration v${version} failed: expected version ${version}, got ${newVersion}`);
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
      debugDatabase(`Database migrated from version ${currentVersion} to ${maxVersion}`);
    }

    this.started = true;
  }
}
