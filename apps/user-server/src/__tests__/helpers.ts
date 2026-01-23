import type { Database as Sqlite3Database } from 'sqlite3';

/**
 * Promisifies sqlite3's callback-based db.run() method for use in tests.
 *
 * @param db - The sqlite3 database instance (accessed via `(database as any).db`)
 * @param sql - The SQL statement to execute
 * @param params - Parameters to bind to the SQL statement
 * @returns A promise that resolves when the statement completes, or rejects on error
 */
export function dbRun(
  db: Sqlite3Database,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
