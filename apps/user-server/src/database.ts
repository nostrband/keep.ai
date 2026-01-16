import sqlite3 from 'sqlite3';
import { User, ApiKey, UsageRecord } from './types';
import { DatabaseError, InsufficientBalanceError, NotFoundError } from './errors';
import { Logger } from './logger';

export class Database {
  private db: sqlite3.Database;
  private logger: Logger;

  constructor(dbPath: string = './keepai.db') {
    this.db = new sqlite3.Database(dbPath);
    this.logger = Logger.getInstance();
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            auth_user_id TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            balance INTEGER DEFAULT 0
          )
        `, (err) => {
          if (err) {
            this.logger.error('Failed to create users table', err);
            reject(new DatabaseError('Failed to create users table', err));
          }
        });

        this.db.run(`
          CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            key_hash TEXT UNIQUE NOT NULL,
            name TEXT,
            expires_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) {
            this.logger.error('Failed to create api_keys table', err);
            reject(new DatabaseError('Failed to create api_keys table', err));
          }
        });

        this.db.run(`
          CREATE TABLE IF NOT EXISTS usage_records (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            api_key_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            tokens_used INTEGER,
            model TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (api_key_id) REFERENCES api_keys (id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) {
            this.logger.error('Failed to create usage_records table', err);
            reject(new DatabaseError('Failed to create usage_records table', err));
          } else {
            this.logger.info('Database initialized successfully');
            resolve();
          }
        });
      });
    });
  }

  async createUser(authUserId: string, initialBalance: number = 0): Promise<User> {
    const userId = this.generateId();
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO users (id, auth_user_id, balance) VALUES (?, ?, ?)',
        [userId, authUserId, initialBalance],
        function(err) {
          if (err) reject(err);
          else {
            resolve({
              id: userId,
              auth_user_id: authUserId,
              created_at: new Date(),
              balance: initialBalance
            });
          }
        }
      );
    });
  }

  async getUserByAuthId(authUserId: string): Promise<User | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE auth_user_id = ?',
        [authUserId],
        (err, row: any) => {
          if (err) reject(err);
          else if (row) {
            resolve({
              id: row.id,
              auth_user_id: row.auth_user_id,
              created_at: new Date(row.created_at),
              balance: row.balance
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  async deleteUser(authUserId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM users WHERE auth_user_id = ?',
        [authUserId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async createApiKey(userId: string, name?: string, expiresAt?: Date): Promise<{ apiKey: string, apiKeyData: ApiKey }> {
    const keyId = this.generateId();
    const apiKey = this.generateApiKey();
    const keyHash = this.hashApiKey(apiKey);
    
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO api_keys (id, user_id, key_hash, name, expires_at) VALUES (?, ?, ?, ?, ?)',
        [keyId, userId, keyHash, name || null, expiresAt?.toISOString() || null],
        function(err) {
          if (err) reject(err);
          else {
            resolve({
              apiKey,
              apiKeyData: {
                id: keyId,
                user_id: userId,
                key_hash: keyHash,
                name,
                expires_at: expiresAt,
                created_at: new Date()
              }
            });
          }
        }
      );
    });
  }

  async findApiKey(keyHash: string): Promise<(ApiKey & { user: User }) | null> {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 
          ak.*,
          u.id as user_id,
          u.auth_user_id,
          u.created_at as user_created_at,
          u.balance
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.key_hash = ? AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))
      `, [keyHash], (err, row: any) => {
        if (err) reject(err);
        else if (row) {
          resolve({
            id: row.id,
            user_id: row.user_id,
            key_hash: row.key_hash,
            name: row.name,
            expires_at: row.expires_at ? new Date(row.expires_at) : undefined,
            created_at: new Date(row.created_at),
            last_used_at: row.last_used_at ? new Date(row.last_used_at) : undefined,
            user: {
              id: row.user_id,
              auth_user_id: row.auth_user_id,
              created_at: new Date(row.user_created_at),
              balance: row.balance
            }
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  async updateApiKeyLastUsed(keyId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
        [keyId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async deductBalance(userId: string, amount: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE users SET balance = balance - ? WHERE id = ?',
        [amount, userId],
        function(err) {
          if (err) {
            reject(new DatabaseError('Failed to deduct balance', err));
          } else {
            resolve();
          }
        }
      );
    });
  }

  async getUserBalance(userId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT balance FROM users WHERE id = ?',
        [userId],
        (err, row: any) => {
          if (err) reject(err);
          else if (row) {
            resolve(row.balance);
          } else {
            reject(new NotFoundError('User not found'));
          }
        }
      );
    });
  }

  async recordUsage(usage: Omit<UsageRecord, 'id' | 'created_at'>): Promise<UsageRecord> {
    const usageId = this.generateId();
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO usage_records (id, user_id, api_key_id, amount, tokens_used, model) VALUES (?, ?, ?, ?, ?, ?)',
        [usageId, usage.user_id, usage.api_key_id, usage.amount, usage.tokens_used || null, usage.model || null],
        function(err) {
          if (err) reject(err);
          else {
            resolve({
              id: usageId,
              ...usage,
              created_at: new Date()
            });
          }
        }
      );
    });
  }

  async getAllUsers(): Promise<User[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM users ORDER BY created_at DESC', (err, rows: any[]) => {
        if (err) reject(err);
        else {
          resolve(rows.map(row => ({
            id: row.id,
            auth_user_id: row.auth_user_id,
            created_at: new Date(row.created_at),
            balance: row.balance
          })));
        }
      });
    });
  }

  async createApiKeyDirect(userId: string, keyHash: string, name?: string): Promise<string> {
    const keyId = this.generateId();
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO api_keys (id, user_id, key_hash, name) VALUES (?, ?, ?, ?)',
        [keyId, userId, keyHash, name || null],
        function(err) {
          if (err) reject(err);
          else resolve(keyId);
        }
      );
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private generateApiKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private hashApiKey(apiKey: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }
}
