import { CRSqliteDB } from "./database";
import { validateInClauseLength } from "./interfaces";

export interface File {
  id: string;
  name: string;
  path: string;
  summary: string;
  upload_time: string;
  media_type: string;
  size: number;
}

export class FileStore {
  private db: CRSqliteDB;

  constructor(db: CRSqliteDB) {
    this.db = db;
  }

  // Insert a new file record
  async insertFile(file: File): Promise<void> {
    await this.db.db.exec(
      `INSERT INTO files (id, name, path, summary, upload_time, media_type, size)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [file.id, file.name, file.path, file.summary, file.upload_time, file.media_type, file.size]
    );
  }

  // Update an existing file record
  async updateFile(file: File): Promise<void> {
    await this.db.db.exec(
      `UPDATE files
       SET name = ?, path = ?, summary = ?, upload_time = ?, media_type = ?, size = ?
       WHERE id = ?`,
      [file.name, file.path, file.summary, file.upload_time, file.media_type, file.size, file.id]
    );
  }

  // Delete a file record by ID
  async deleteFile(id: string): Promise<void> {
    await this.db.db.exec(
      `DELETE FROM files WHERE id = ?`,
      [id]
    );
  }

  // Get a file record by ID
  async getFile(id: string): Promise<File | null> {
    const results = await this.db.db.execO<Record<string, unknown>>(
      `SELECT id, name, path, summary, upload_time, media_type, size
       FROM files
       WHERE id = ?`,
      [id]
    );

    if (!results || results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id as string,
      name: row.name as string,
      path: row.path as string,
      summary: row.summary as string,
      upload_time: row.upload_time as string,
      media_type: row.media_type as string,
      size: row.size as number,
    };
  }

  // Get multiple file records by IDs
  async getFiles(ids: string[]): Promise<File[]> {
    if (ids.length === 0) {
      return [];
    }
    validateInClauseLength(ids, 'getFiles');

    // Create placeholders for the IN clause (?, ?, ?, ...)
    const placeholders = ids.map(() => '?').join(', ');
    
    const sql = `SELECT id, name, path, summary, upload_time, media_type, size
                 FROM files
                 WHERE id IN (${placeholders})
                 ORDER BY upload_time DESC`;

    const results = await this.db.db.execO<Record<string, unknown>>(sql, ids);

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      path: row.path as string,
      summary: row.summary as string,
      upload_time: row.upload_time as string,
      media_type: row.media_type as string,
      size: row.size as number,
    }));
  }

  // List file records with optional filtering and pagination
  async listFiles(
    media_type?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<File[]> {
    let sql = `SELECT id, name, path, summary, upload_time, media_type, size
               FROM files`;
    const args: (string | number)[] = [];

    // Filter by media type if provided
    if (media_type) {
      sql += ` WHERE media_type = ?`;
      args.push(media_type);
    }

    // Order by upload_time descending (most recent first) and apply pagination
    sql += ` ORDER BY upload_time DESC LIMIT ? OFFSET ?`;
    args.push(limit, offset);

    const results = await this.db.db.execO<Record<string, unknown>>(sql, args);

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      path: row.path as string,
      summary: row.summary as string,
      upload_time: row.upload_time as string,
      media_type: row.media_type as string,
      size: row.size as number,
    }));
  }

  // Search files by path or summary
  async searchFiles(query: string, limit: number = 50): Promise<File[]> {
    const sql = `SELECT id, name, path, summary, upload_time, media_type, size
                 FROM files
                 WHERE id LIKE ? OR name LIKE ? OR path LIKE ? OR summary LIKE ?
                 ORDER BY upload_time DESC
                 LIMIT ?`;

    const searchPattern = `%${query}%`;
    const results = await this.db.db.execO<Record<string, unknown>>(
      sql,
      [searchPattern, searchPattern, searchPattern, searchPattern, limit]
    );

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      path: row.path as string,
      summary: row.summary as string,
      upload_time: row.upload_time as string,
      media_type: row.media_type as string,
      size: row.size as number,
    }));
  }

  // Count total files, optionally filtered by media type
  async countFiles(media_type?: string): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM files`;
    const args: string[] = [];

    if (media_type) {
      sql += ` WHERE media_type = ?`;
      args.push(media_type);
    }

    const results = await this.db.db.execO<{ count: number }>(sql, args);
    return results?.[0]?.count || 0;
  }

  // Get files by media type pattern (e.g., 'image/*', 'video/*')
  async getFilesByMediaTypePattern(pattern: string, limit: number = 100): Promise<File[]> {
    const sql = `SELECT id, name, path, summary, upload_time, media_type, size
                 FROM files
                 WHERE media_type LIKE ?
                 ORDER BY upload_time DESC
                 LIMIT ?`;

    const results = await this.db.db.execO<Record<string, unknown>>(sql, [pattern, limit]);

    if (!results) return [];

    return results.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      path: row.path as string,
      summary: row.summary as string,
      upload_time: row.upload_time as string,
      media_type: row.media_type as string,
      size: row.size as number,
    }));
  }
}