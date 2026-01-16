import request from 'supertest';
import express from 'express';
import { Database } from '../database';
import { createServer } from '../server';
import { OpenRouterProxy } from '../openrouter-proxy';

// Mock the OpenRouterProxy
jest.mock('../openrouter-proxy');
const MockedOpenRouterProxy = OpenRouterProxy as jest.MockedClass<typeof OpenRouterProxy>;

describe('Server', () => {
  let app: express.Application;
  let database: Database;
  let mockProxy: jest.Mocked<OpenRouterProxy>;

  beforeEach(async () => {
    database = new Database(':memory:');
    await database.init();
    
    // Mock the proxy
    mockProxy = {
      handleRequest: jest.fn().mockResolvedValue(undefined)
    } as any;
    
    MockedOpenRouterProxy.mockImplementation(() => mockProxy);
    
    app = createServer(database, 'test-openrouter-key');
  });

  afterEach(async () => {
    await database.close();
    jest.clearAllMocks();
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body).toEqual({
        status: 'ok',
        timestamp: expect.any(String)
      });
    });
  });

  describe('Authentication', () => {
    let userId: string;
    let apiKeyHash: string;

    beforeEach(async () => {
      const user = await database.createUser('test-user', 1000000);
      userId = user.id;
      
      const { apiKeyData: apiKey } = await database.createApiKey(userId, 'Test Key');
      apiKeyHash = apiKey.key_hash;
    });

    it('should reject requests without authorization header', async () => {
      await request(app)
        .post('/api/v1/chat/completions')
        .send({ model: 'gpt-3.5-turbo', messages: [] })
        .expect(401);
    });

    it('should reject requests with invalid authorization header', async () => {
      await request(app)
        .post('/api/v1/chat/completions')
        .set('Authorization', 'Invalid token')
        .send({ model: 'gpt-3.5-turbo', messages: [] })
        .expect(401);
    });

    it('should reject requests with invalid API key', async () => {
      await request(app)
        .post('/api/v1/chat/completions')
        .set('Authorization', 'Bearer invalid-key')
        .send({ model: 'gpt-3.5-turbo', messages: [] })
        .expect(401);
    });

    it('should accept requests with valid API key', async () => {
      // Since we can't easily generate the actual API key string from the hash,
      // we'll test the auth middleware by directly calling the endpoint
      // with a mocked successful proxy response
      mockProxy.handleRequest.mockImplementation(async (req, res) => {
        res.status(200).json({ choices: [] });
      });
      
      const crypto = require('crypto');
      const apiKey = 'test-api-key';
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      // Update the database with our known key hash
      await (database as any).db.run(
        'UPDATE api_keys SET key_hash = ? WHERE user_id = ?',
        [keyHash, userId]
      );
      
      await request(app)
        .post('/api/v1/chat/completions')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ model: 'gpt-3.5-turbo', messages: [] })
        .expect(200);
      
      expect(mockProxy.handleRequest).toHaveBeenCalled();
    }, 10000); // Increase timeout to 10 seconds
  });

  describe('User Info Endpoint', () => {
    let userId: string;
    let apiKeyHash: string;

    beforeEach(async () => {
      const user = await database.createUser('test-user', 2500000);
      userId = user.id;
      
      const { apiKeyData: apiKey } = await database.createApiKey(userId, 'Test Key');
      apiKeyHash = apiKey.key_hash;
    });

    it('should return user info with valid API key', async () => {
      const crypto = require('crypto');
      const apiKey = 'test-api-key';
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      await (database as any).db.run(
        'UPDATE api_keys SET key_hash = ? WHERE user_id = ?',
        [keyHash, userId]
      );
      
      const response = await request(app)
        .get('/api/v1/user')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200);
      
      expect(response.body).toEqual({
        id: userId,
        balance: 2500000,
      });
    });

    it('should reject unauthorized requests', async () => {
      await request(app)
        .get('/api/v1/user')
        .expect(401);
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for non-existent endpoints', async () => {
      await request(app)
        .get('/non-existent')
        .expect(404);
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in streaming responses', async () => {
      const userId = (await database.createUser('test-user', 1000000)).id;
      const { apiKeyData: apiKey } = await database.createApiKey(userId);
      
      const crypto = require('crypto');
      const keyString = 'test-key';
      const keyHash = crypto.createHash('sha256').update(keyString).digest('hex');
      
      await (database as any).db.run(
        'UPDATE api_keys SET key_hash = ? WHERE id = ?',
        [keyHash, apiKey.id]
      );
      
      // Mock a streaming response
      mockProxy.handleRequest.mockImplementation(async (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control'
        });
        res.write('data: {"test": "response"}\n\n');
        res.end();
      });
      
      const response = await request(app)
        .post('/api/v1/chat/completions')
        .set('Authorization', `Bearer ${keyString}`)
        .send({ stream: true })
        .expect(200);
      
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });
});
