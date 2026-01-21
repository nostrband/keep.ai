// Database interface that abstracts cr-sqlite implementations
export interface DBInterface {
  exec(sql: string, args?: any[]): Promise<any>;
  execO<T = any>(sql: string, args?: any[]): Promise<T[] | null>;
  execManyArgs(sql: string, args?: any[][]): Promise<any[]>;
  tx<T>(fn: (tx: DBInterface) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Factory function type for creating database instances
export type CreateDBFunction = (file: string) => Promise<DBInterface>;

// Maximum number of items allowed in SQL IN clauses.
// This prevents resource exhaustion from overly large queries.
// SQLite has a limit of 999 variables by default, so 1000 is a safe maximum.
export const MAX_IN_CLAUSE_LENGTH = 1000;

/**
 * Validates that an array is not too large for use in an IN clause.
 * Throws an error with a descriptive message if the limit is exceeded.
 */
export function validateInClauseLength(ids: unknown[], methodName: string): void {
  if (ids.length > MAX_IN_CLAUSE_LENGTH) {
    throw new Error(
      `${methodName}: Array too large for IN clause. ` +
      `Maximum ${MAX_IN_CLAUSE_LENGTH} items allowed, got ${ids.length}. ` +
      `Consider using pagination or batch processing.`
    );
  }
}
