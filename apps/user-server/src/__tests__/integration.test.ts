import { Database } from '../database';

describe('Database Integration Tests', () => {
  let database: Database;

  beforeAll(async () => {
    database = new Database(':memory:');
    await database.init();
  });

  afterAll(async () => {
    await database.close();
  });

  it('should handle the complete user lifecycle', async () => {
    // Create user
    const user = await database.createUser('integration-user', 5000000);
    expect(user.balance).toBe(5000000);

    // Create API key
    const { apiKeyData: apiKey } = await database.createApiKey(user.id, 'Integration Test Key');
    expect(apiKey.user_id).toBe(user.id);

    // Find API key
    const crypto = require('crypto');
    const keyString = 'integration-test-key';
    const keyHash = crypto.createHash('sha256').update(keyString).digest('hex');
    
    await new Promise<void>((resolve, reject) => {
      (database as any).db.run(
        'UPDATE api_keys SET key_hash = ? WHERE id = ?',
        [keyHash, apiKey.id],
        (err: Error | null) => err ? reject(err) : resolve()
      );
    });

    const foundKey = await database.findApiKey(keyHash);
    expect(foundKey).not.toBeNull();
    expect(foundKey!.user.id).toBe(user.id);

    // Deduct balance
    await database.deductBalance(user.id, 1000000);
    
    const updatedUser = await database.getUserByAuthId('integration-user');
    expect(updatedUser!.balance).toBe(4000000);

// Record usage and deduct additional balance
    await database.deductBalance(user.id, 1000000);
    const usage = await database.recordUsage({
      user_id: user.id,
      api_key_id: apiKey.id,
      amount: 1000000,
      tokens_used: 1000,
      model: 'gpt-4'
    });
    
    expect(usage.amount).toBe(1000000);
    expect(usage.tokens_used).toBe(1000);
    expect(usage.model).toBe('gpt-4');

    // Verify final balance (started 5M, deducted 1M twice = 3M)
    const finalUser = await database.getUserByAuthId('integration-user');
    expect(finalUser!.balance).toBe(3000000);
  });

it('should handle multiple users correctly', async () => {
    const users: any[] = [];
    for (let i = 0; i < 5; i++) {
      const user = await database.createUser(`user-${i}`, (i + 1) * 1000000);
      users.push(user);
    }

    const allUsers = await database.getAllUsers();
    expect(allUsers.length).toBeGreaterThanOrEqual(5);

    // Check that our created users exist by checking auth IDs
    const authIds = allUsers.map(u => u.auth_user_id);
    for (const user of users) {
      expect(authIds).toContain(user.auth_user_id);
    }
  });

  it('should handle API key expiry correctly', async () => {
    const user = await database.createUser('expiry-user', 1000000);
    
    // Create expired key
    const pastDate = new Date(Date.now() - 86400000);
    const { apiKeyData: expiredKey } = await database.createApiKey(user.id, 'Expired Key', pastDate);
    
    // Create valid key
    const futureDate = new Date(Date.now() + 86400000);
    const { apiKeyData: validKey } = await database.createApiKey(user.id, 'Valid Key', futureDate);
    
    // Try to find expired key
    const foundExpired = await database.findApiKey(expiredKey.key_hash);
    expect(foundExpired).toBeNull();
    
    // Try to find valid key
    const crypto = require('crypto');
    const keyString = 'valid-key-string';
    const keyHash = crypto.createHash('sha256').update(keyString).digest('hex');
    
    await new Promise<void>((resolve, reject) => {
      (database as any).db.run(
        'UPDATE api_keys SET key_hash = ? WHERE id = ?',
        [keyHash, validKey.id],
        (err: Error | null) => err ? reject(err) : resolve()
      );
    });

    const foundValid = await database.findApiKey(keyHash);
    expect(foundValid).not.toBeNull();
    expect(foundValid!.name).toBe('Valid Key');
  });
});
