import { Database } from '../database';
import * as sqlite3 from 'sqlite3';

describe('Database', () => {
  let database: Database;

  beforeEach(async () => {
    database = new Database(':memory:');
    await database.init();
  });

  afterEach(async () => {
    await database.close();
  });

  describe('User Management', () => {
    it('should create a new user', async () => {
      const user = await database.createUser('test-auth-id', 1000000);
      
      expect(user.id).toBeDefined();
      expect(user.auth_user_id).toBe('test-auth-id');
      expect(user.balance).toBe(1000000);
      expect(user.created_at).toBeInstanceOf(Date);
    });

    it('should retrieve user by auth ID', async () => {
      const createdUser = await database.createUser('test-auth-id', 500000);
      const retrievedUser = await database.getUserByAuthId('test-auth-id');
      
      expect(retrievedUser).not.toBeNull();
      expect(retrievedUser!.id).toBe(createdUser.id);
      expect(retrievedUser!.auth_user_id).toBe('test-auth-id');
      expect(retrievedUser!.balance).toBe(500000);
    });

    it('should return null for non-existent user', async () => {
      const user = await database.getUserByAuthId('non-existent');
      expect(user).toBeNull();
    });

    it('should prevent duplicate auth IDs', async () => {
      await database.createUser('test-auth-id', 1000000);
      
      await expect(database.createUser('test-auth-id', 2000000))
        .rejects.toThrow();
    });
  });

  describe('API Key Management', () => {
    let userId: string;

    beforeEach(async () => {
      const user = await database.createUser('test-auth-id', 1000000);
      userId = user.id;
    });

    it('should create an API key', async () => {
      const { apiKeyData: apiKey, apiKey: rawKey } = await database.createApiKey(userId, 'Test Key');
      
      expect(apiKey.id).toBeDefined();
      expect(apiKey.user_id).toBe(userId);
      expect(apiKey.name).toBe('Test Key');
      expect(apiKey.created_at).toBeInstanceOf(Date);
      expect(rawKey).toBeDefined();
    });

    it('should create API key with expiry', async () => {
      const expiryDate = new Date(Date.now() + 86400000); // Tomorrow
      const { apiKeyData: apiKey } = await database.createApiKey(userId, 'Expiring Key', expiryDate);
      
      expect(apiKey.expires_at).toEqual(expiryDate);
    });

    it('should find valid API key', async () => {
      const { apiKeyData: apiKey } = await database.createApiKey(userId, 'Test Key');
      const crypto = require('crypto');
      const keyString = 'test-key-string';
      const keyHash = crypto.createHash('sha256').update(keyString).digest('hex');
      
      // Manually update the key hash for testing
      await (database as any).db.run(
        'UPDATE api_keys SET key_hash = ? WHERE id = ?',
        [keyHash, apiKey.id]
      );
      
      const found = await database.findApiKey(keyHash);
      expect(found).not.toBeNull();
      expect(found!.user_id).toBe(userId);
      expect(found!.user.auth_user_id).toBe('test-auth-id');
    });

    it('should not find expired API key', async () => {
      const pastDate = new Date(Date.now() - 86400000); // Yesterday
      const { apiKeyData: apiKey } = await database.createApiKey(userId, 'Expired Key', pastDate);
      
      const found = await database.findApiKey(apiKey.key_hash);
      expect(found).toBeNull();
    });
  });

  describe('Balance Management', () => {
    let userId: string;

    beforeEach(async () => {
      const user = await database.createUser('test-auth-id', 1000000);
      userId = user.id;
    });

    it('should deduct balance successfully', async () => {
      await database.deductBalance(userId, 500000);
      
      const user = await database.getUserByAuthId('test-auth-id');
      expect(user!.balance).toBe(500000);
    });

    it('should record usage', async () => {
      const { apiKeyData: apiKey } = await database.createApiKey(userId);
      
      await database.deductBalance(userId, 100000);
      const usage = await database.recordUsage({
        user_id: userId,
        api_key_id: apiKey.id,
        amount: 100000,
        tokens_used: 150,
        model: 'gpt-3.5-turbo'
      });
      
      expect(usage.id).toBeDefined();
      expect(usage.user_id).toBe(userId);
      expect(usage.api_key_id).toBe(apiKey.id);
      expect(usage.amount).toBe(100000);
      expect(usage.tokens_used).toBe(150);
      expect(usage.model).toBe('gpt-3.5-turbo');
    });
  });

  describe('getAllUsers', () => {
    it('should return all users', async () => {
      await database.createUser('user1', 1000000);
      await database.createUser('user2', 2000000);
      
      const users = await database.getAllUsers();
      expect(users).toHaveLength(2);
    });

    it('should return empty array when no users', async () => {
      const users = await database.getAllUsers();
      expect(users).toHaveLength(0);
    });
  });
});
