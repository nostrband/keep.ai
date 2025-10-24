// Browser implementation using cr-sqlite wasm
import sqliteWasm, { SQLite3, DB } from "@vlcn.io/crsqlite-wasm";
import { DBInterface } from "@app/db";
import debug from "debug";

const debugBrowser = debug("browser:index");

let sqlite: SQLite3 | null = null;

// Wrapper class to adapt cr-sqlite DB to our DBInterface
class CRSqliteDBWrapper implements DBInterface {
  constructor(private db: DB) {}

  async exec(sql: string, args?: any[]): Promise<any> {
    return this.db.exec(sql, args);
  }

  async execO<T = any>(sql: string, args?: any[]): Promise<T[] | null> {
    return this.db.execO(sql, args) as Promise<T[] | null>;
  }

  async tx<T>(fn: (tx: DBInterface) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.db
        .tx(async (tx: any) => {
          try {
            const wrappedTx = new CRSqliteDBWrapper(tx);
            const result = await fn(wrappedTx);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        })
        .catch(reject);
    });
  }

  async close(): Promise<void> {
    try {
      // Try to finalize any cr-sqlite internal statements
      await this.db.exec("SELECT crsql_finalize()");
    } catch (error) {
      // If crsql_finalize doesn't exist or fails, just log a warning
      debugBrowser("CRSqlite finalize warning:", error);
    }

    return this.db.close();
  }
}

export async function createDBBrowser(
  file: string,
  wasmUrl?: string
): Promise<DBInterface> {
  try {
    // Initialize sqlite with wasm file loader if not already done
    if (!sqlite) {
      sqlite = await sqliteWasm(
        (_file: string) =>
          wasmUrl ||
          "https://esm.sh/@vlcn.io/crsqlite-wasm@0.16.0/dist/crsqlite.wasm"
      );
    }

    // Open database
    const db = await sqlite.open(file);

    // Wrap the DB instance
    const wrappedDB = new CRSqliteDBWrapper(db);

    debugBrowser("Browser database created and initialized successfully");
    return wrappedDB;
  } catch (error) {
    debugBrowser("Failed to create browser database:", error);
    throw error;
  }
}
