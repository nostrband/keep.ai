import request from 'supertest';
import express from 'express';
import { Database } from '../database';
import { createServer } from '../server';
import { clerkClient } from '@clerk/clerk-sdk-node';

// Mock Clerk
jest.mock('@clerk/clerk-sdk-node', () => ({
  clerkClient: {
    verifyToken: jest.fn()
  }
}));

// Mock OpenRouterProxy
jest.mock('../openrouter-proxy', () => {
    return {
        OpenRouterProxy: jest.fn().mockImplementation(() => ({
            handleRequest: jest.fn()
        }))
    };
});

describe('API Key Exchange', () => {
  let app: express.Application;
  let database: Database;

  beforeEach(async () => {
    database = new Database(':memory:');
    await database.init();
    app = createServer(database, 'test-key');
  });

  afterEach(async () => {
    await database.close();
    jest.clearAllMocks();
  });

  it('should exchange valid Clerk token for API key', async () => {
    const authUserId = 'user_123';
    // Create user first (simulating webhook)
    const user = await database.createUser(authUserId);

    // Mock Clerk verification
    (clerkClient.verifyToken as jest.Mock).mockResolvedValue({
      sub: authUserId,
      sid: 'sess_123'
    });

    const response = await request(app)
      .post('/api/v1/api-key')
      .set('Authorization', 'Bearer valid_clerk_token')
      .expect(200);

    expect(response.body).toHaveProperty('apiKey');
    expect(response.body).toHaveProperty('expiresAt');
    expect(typeof response.body.apiKey).toBe('string');
    
    // Verify expiration is roughly 30 days in future
    const expiresAt = new Date(response.body.expiresAt);
    const now = new Date();
    const daysDiff = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeCloseTo(30, 0); // Within <1 day precision

    // Verify key works
    const apiKey = response.body.apiKey;
    const crypto = require('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    const storedKey = await database.findApiKey(keyHash);
    expect(storedKey).toBeTruthy();
    expect(storedKey?.user_id).toBe(user.id);
  });

  it('should return 404 if user not found', async () => {
    const authUserId = 'user_unknown';
    
    (clerkClient.verifyToken as jest.Mock).mockResolvedValue({
      sub: authUserId
    });

    await request(app)
      .post('/api/v1/api-key')
      .set('Authorization', 'Bearer valid_token_but_no_user')
      .expect(404);
  });

  it('should return 401 if token invalid', async () => {
    (clerkClient.verifyToken as jest.Mock).mockRejectedValue(new Error('Invalid token'));

    await request(app)
      .post('/api/v1/api-key')
      .set('Authorization', 'Bearer invalid_token')
      .expect(401);
  });

  it('should return 401 if no token provided', async () => {
    await request(app)
      .post('/api/v1/api-key')
      .expect(401);
  });
});
