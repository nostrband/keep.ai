// Database interface that abstracts cr-sqlite implementations
export interface DBInterface {
  exec(sql: string, args?: any[]): Promise<any>;
  execO<T = any>(sql: string, args?: any[]): Promise<T[] | null>;
  tx<T>(fn: (tx: DBInterface) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Factory function type for creating database instances
export type CreateDBFunction = (file: string) => Promise<DBInterface>;
