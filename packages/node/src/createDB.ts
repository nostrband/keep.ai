// Node.js implementation using sqlite3 + cr-sqlite extension
import sqlite3 from "sqlite3";
import { extensionPath } from "@nostrband/crsqlite";
import { DBInterface } from '@app/db';
import debug from "debug";

const debugNode = debug("node:index");

// Wrapper class to adapt sqlite3 + cr-sqlite to our DBInterface
class Sqlite3DBWrapper implements DBInterface {
  private txQueue: Promise<any> = Promise.resolve();
  
  constructor(private db: sqlite3.Database, private isTx: boolean) {}

  async exec(sql: string, args?: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      if (args && args.length > 0) {
        this.db.run(sql, args, function(err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      } else {
        this.db.exec(sql, (err) => {
          if (err) reject(err);
          else resolve(undefined);
        });
      }
    });
  }

  async execO<T = any>(sql: string, args?: any[]): Promise<T[] | null> {
    return new Promise((resolve, reject) => {
      if (args && args.length > 0) {
        this.db.all(sql, args, (err, rows) => {
          if (err) reject(err);
          else resolve(rows && rows.length > 0 ? rows as T[] : null);
        });
      } else {
        this.db.all(sql, (err, rows) => {
          if (err) reject(err);
          else resolve(rows && rows.length > 0 ? rows as T[] : null);
        });
      }
    });
  }

  async execManyArgs(sql: string, args?: any[][]): Promise<any[]> {
    if (!args || args.length === 0) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(sql, (err) => {
        if (err) {
          reject(err);
          return;
        }

        const results: any[] = [];
        let currentIndex = 0;
        let finalized = false;

        // Safe finalize that only runs once
        const safeFinalize = (callback: (err?: Error | null) => void) => {
          if (finalized) {
            callback();
            return;
          }
          finalized = true;
          stmt.finalize(callback);
        };

        // Execute statements sequentially to avoid SQLite race conditions
        const executeNext = () => {
          if (currentIndex >= args.length) {
            // All done, finalize and resolve
            safeFinalize((finalizeErr) => {
              if (finalizeErr) {
                reject(finalizeErr);
              } else {
                resolve(results);
              }
            });
            return;
          }

          const argSet = args[currentIndex];
          const index = currentIndex;
          currentIndex++;

          stmt.run(argSet || [], function(runErr) {
            if (runErr) {
              safeFinalize(() => reject(runErr));
              return;
            }

            results[index] = { lastID: this.lastID, changes: this.changes };
            executeNext(); // Execute next statement after current completes
          });
        };

        executeNext();
      });
    });
  }

  async tx<T>(fn: (tx: DBInterface) => Promise<T>): Promise<T> {
    if (this.isTx) throw new Error("Cannot start tx within a tx");
    // Queue transactions to prevent "cannot start a transaction within a transaction" errors
    return new Promise<T>((resolve, reject) => {
      // Chain this transaction after the previous one completes
      this.txQueue = this.txQueue
        .then(async () => {
          try {
            await this.exec("BEGIN TRANSACTION");
            
            try {
              // Create a transaction wrapper that uses the same database instance
              const txWrapper = new Sqlite3DBWrapper(this.db, true);
              const result = await fn(txWrapper);
              
              await this.exec("COMMIT");
              resolve(result);
            } catch (error) {
              debugNode("tx error", error);
              await this.exec("ROLLBACK");
              reject(error);
            }
          } catch (error) {
            reject(error);
          }
        })
        .catch((error) => {
          // If the queue itself has an error from a previous transaction,
          // we still need to continue processing this transaction
          debugNode("txQueue error (continuing)", error);
        });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use wait() to ensure all pending operations are complete
      this.db.wait((waitErr) => {
        if (waitErr) {
          debugNode("Database wait error:", waitErr);
        }
        
        // Try to finalize any cr-sqlite internal statements
        try {
          // Execute cr-sqlite cleanup if available
          this.db.run("SELECT crsql_finalize()", (finalizeErr) => {
            if (finalizeErr) {
              debugNode("CRSqlite finalize warning:", finalizeErr);
            }
            
            // Now try to close the database
            this.db.close((closeErr) => {
              debugNode("sqlite3 close", closeErr);
              if (closeErr) {
                reject(closeErr);
              } else {
                resolve();
              }
            });
          });
        } catch (error) {
          // If crsql_finalize doesn't exist, just try to close normally
          this.db.close((closeErr) => {
            debugNode("sqlite3 close", closeErr);
            if (closeErr) {
              reject(closeErr);
            } else {
              resolve();
            }
          });
        }
      });
    });
  }
}

export async function createDBNode(file: string): Promise<DBInterface> {
  return new Promise((resolve, reject) => {
    try {
      // Create sqlite3 database instance
      const db = new sqlite3.Database(file, (err) => {
        if (err) {
          reject(err);
          return;
        }

        try {
          // Suggested settings for best performance of sqlite
          db.run("PRAGMA journal_mode = WAL");
          db.run("PRAGMA synchronous = NORMAL");
          db.run("PRAGMA busy_timeout=10000;")

          // Load cr-sqlite extension
          db.loadExtension(extensionPath, (err) => {
            if (err) {
              debugNode("CR-sqlite extension failed to load", err);
              reject(err);
              return;
            }
            
            // Wrap the DB instance
            const wrappedDB = new Sqlite3DBWrapper(db, false);
            
            debugNode("Node.js database created and initialized successfully");
            resolve(wrappedDB);
          });
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      debugNode("Failed to create Node.js database:", error);
      reject(error);
    }
  });
}
