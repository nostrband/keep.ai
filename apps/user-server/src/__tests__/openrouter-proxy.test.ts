import { OpenRouterProxy } from '../openrouter-proxy';
import { Database } from '../database';
import { Request, Response } from 'express';

// Mock https module
jest.mock('https');
const https = require('https');

describe('OpenRouterProxy', () => {
  let proxy: OpenRouterProxy;
  let database: Database;
  let mockRequest: jest.Mocked<any>;
  let mockResponse: jest.Mocked<Response>;

  beforeEach(async () => {
    database = new Database(':memory:');
    await database.init();
    proxy = new OpenRouterProxy('test-openrouter-key', database);

    // Mock Request and Response objects
    mockRequest = {
      method: 'POST',
      body: { model: 'gpt-3.5-turbo', messages: [] },
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer test-api-key'
      }
    } as any;

    mockResponse = {
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      headersSent: false
    } as any;

    // Reset https mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await database.close();
  });

  describe('handleRequest', () => {
    let userId: string;
    let apiKeyId: string;

    beforeEach(async () => {
      const user = await database.createUser('test-user', 1000000);
      userId = user.id;
      const { apiKeyData: apiKey } = await database.createApiKey(userId);
      apiKeyId = apiKey.id;

      // Add apiKey to request
      (mockRequest as any).apiKey = {
        id: apiKeyId,
        user_id: userId,
        user: user
      };
    });

it('should handle non-streaming requests', async () => {
      const mockProxyReq = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn()
      } as any;

      const mockProxyRes = {
        statusCode: 200,
        headers: {},
        on: jest.fn()
      } as any;

      const mockRequestInstance = {
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'response') {
            callback(mockProxyRes);
          }
        }),
        write: jest.fn(),
        end: jest.fn()
      } as any;

      https.request.mockReturnValue(mockRequestInstance);

      // Mock the response data
      mockProxyRes.on.mockImplementation((event: any, callback: any) => {
        if (event === 'data') {
          callback('{"choices": [], "usage": {"total_tokens": 100, "cost": 0.001}}');
        } else if (event === 'end') {
          callback();
        }
      });

      await proxy.handleRequest(mockRequest as any, mockResponse);

      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'openrouter.ai',
          path: '/api/v1/chat/completions',
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-openrouter-key',
            'Content-Type': 'application/json'
          })
        }),
        expect.any(Function)
      );

      expect(mockRequestInstance.write).toHaveBeenCalledWith(
        JSON.stringify(mockRequest.body)
      );
    });

    it('should handle streaming requests', async () => {
      mockRequest.body.stream = true;

      const mockProxyReq = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn()
      } as any;

      const mockProxyRes = {
        statusCode: 200,
        on: jest.fn()
      } as any;

      const mockRequestInstance = {
        on: jest.fn().mockImplementation((event, callback) => {
          if (event === 'response') {
            callback(mockProxyRes);
          }
        }),
        write: jest.fn(),
        end: jest.fn()
      } as any;

      https.request.mockReturnValue(mockRequestInstance);

      // Mock streaming response
      mockProxyRes.on.mockImplementation((event: any, callback: any) => {
        if (event === 'data') {
          callback('data: {"usage": {"total_tokens": 50, "cost": 0.0005}}\n\n');
          callback('data: [DONE]\n\n');
        } else if (event === 'end') {
          callback();
        }
      });

      await proxy.handleRequest(mockRequest as any, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });
    });

    it('should handle unauthorized requests', async () => {
      (mockRequest as any).apiKey = undefined;

      await proxy.handleRequest(mockRequest as any, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });
  });

  describe('calculateCost', () => {
    it('should return cost from usage when provided', () => {
      const usage = { cost: 0.002 };
      expect((proxy as any).calculateCost(usage)).toBe(0.002);
    });

    it('should calculate fallback cost when usage.cost not provided', () => {
      const usage = { total_tokens: 2000 };
      const expectedCost = (2000 / 1000) * 0.001; // 0.002
      expect((proxy as any).calculateCost(usage)).toBe(expectedCost);
    });

    it('should return 0 when no usage provided', () => {
      expect((proxy as any).calculateCost(undefined)).toBe(0);
    });
  });

  describe('filterHeaders', () => {
    it('should filter out authorization and host headers', () => {
      const headers = {
        'content-type': 'application/json',
        'authorization': 'Bearer token',
        'host': 'localhost',
        'user-agent': 'test-agent'
      };

      const filtered = (proxy as any).filterHeaders(headers);

      expect(filtered).toEqual({
        'content-type': 'application/json',
        'user-agent': 'test-agent'
      });
    });

    it('should handle array header values', () => {
      const headers = {
        'accept': ['application/json', 'text/plain'],
        'x-custom': 'value'
      };

      const filtered = (proxy as any).filterHeaders(headers);

      expect(filtered).toEqual({
        'accept': 'application/json, text/plain',
        'x-custom': 'value'
      });
    });

    it('should handle undefined header values', () => {
      const headers = {
        'defined': 'value',
        'undefined': undefined
      };

      const filtered = (proxy as any).filterHeaders(headers);

      expect(filtered).toEqual({
        'defined': 'value'
      });
    });
  });
});
