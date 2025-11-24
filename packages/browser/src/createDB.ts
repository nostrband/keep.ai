// Browser implementation using cr-sqlite wasm
import sqliteWasm, { SQLite3, DB } from "@vlcn.io/crsqlite-wasm";
import { DBInterface } from "@app/db";
import debug from "debug";

const debugBrowser = debug("browser:index");

let sqlite: SQLite3 | null = null;

// Wrapper class to adapt cr-sqlite DB to our DBInterface
class CRSqliteDBWrapper implements DBInterface {
  constructor(private db: DB, private isTx: boolean) {}

  async exec(sql: string, args?: any[]): Promise<any> {
    return this.db.exec(sql, args);
  }

  async execO<T = any>(sql: string, args?: any[]): Promise<T[] | null> {
    return this.db.execO(sql, args) as Promise<T[] | null>;
  }

  async execManyArgs(sql: string, args?: any[][]): Promise<any[]> {
    if (!args || args.length === 0) {
      return [];
    }

    const stmt = await this.db.prepare(sql);
    const results: any[] = [];

    const tx = this.isTx ? this.db : null;
    try {
      for (const argSet of args) {
        const result = await stmt.run(tx, ...(argSet || []));
        results.push(result);
      }
    } finally {
      stmt.finalize(this.db);
    }

    return results;
  }

  async tx<T>(fn: (tx: DBInterface) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.db
        .tx(async (tx: any) => {
          const wrappedTx = new CRSqliteDBWrapper(tx, true);
          const result = await fn(wrappedTx);
          resolve(result);
        })
        // tx will rollback and forward the error here
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

    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("PRAGMA synchronous = NORMAL;");
    await db.exec("PRAGMA busy_timeout = 10000;");
    // No effect
    // await db.exec("PRAGMA page_size = 8192;");
    // const ps = await db.execA("PRAGMA page_size");
    // debugBrowser("DB page_size", ps);

    // 4k causes 'malformed db' on reload
    await db.exec("PRAGMA cache_size = 2048;"); // pages
    // Made 2k change batches work better
    await db.exec("PRAGMA temp_store = MEMORY;");
    await db.exec("PRAGMA cache_spill = OFF;");
    // No effect, but won't hurt
    await db.exec("PRAGMA locking_mode = exclusive");

    // db.onUpdate((type, db, tbl, row) =>
    //   console.log("DB CHANGE", type, db, tbl, row)
    // );

    // Wrap the DB instance
    const wrappedDB = new CRSqliteDBWrapper(db, false);

    debugBrowser("Browser database created and initialized successfully");
    return wrappedDB;
  } catch (error) {
    debugBrowser("Failed to create browser database:", error);
    throw error;
  }
}
