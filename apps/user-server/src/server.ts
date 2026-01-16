import express from 'express';
import { Database } from './database';
import { createAuthMiddleware, AuthenticatedRequest } from './auth';
import { OpenRouterProxy } from './openrouter-proxy';
import { Logger } from './logger';
import { AppError } from './errors';
import { createWebhookHandler } from './webhooks';
import { clerkClient } from '@clerk/clerk-sdk-node';

export function createServer(database: Database, openrouterApiKey: string): express.Application {
  const app = express();
  const logger = Logger.getInstance();
  const auth = createAuthMiddleware(database);
  const proxy = new OpenRouterProxy(openrouterApiKey, database);

  // Webhook endpoint - must be before express.json() to get raw body
  app.post('/api/webhooks', express.raw({ type: 'application/json' }), createWebhookHandler(database));

  app.use(express.json());
  app.use(express.raw({ type: 'application/json', limit: '10mb' }));

  // Request logging middleware
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path} - ${req.ip}`);
    next();
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // OpenRouter proxy endpoint
  app.all('/api/v1/chat/completions', auth, async (req: AuthenticatedRequest, res) => {
    await proxy.handleRequest(req, res);
  });

  // Exchange Clerk token for API key
  app.post('/api/v1/api-key', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing bearer token' });
      }
      
      const token = authHeader.substring(7);
      
      // Verify the token using Clerk SDK
      // This requires CLERK_SECRET_KEY to be set in environment
      const tokenPayload = await clerkClient.verifyToken(token);
      const authUserId = tokenPayload.sub;

      // Find user in database
      const user = await database.getUserByAuthId(authUserId);
      if (!user) {
        logger.warn(`Token exchange attempted for unknown user: ${authUserId}`);
        return res.status(404).json({ error: 'User not found' });
      }

      // Generate new API key with 30 day expiration
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      const { apiKey, apiKeyData } = await database.createApiKey(
        user.id, 
        'Mobile/Web Client Key',
        expiresAt
      );
      
      logger.info(`Generated new API key for user ${user.id} (${authUserId})`);
      
      res.json({ 
        apiKey,
        expiresAt: apiKeyData.expires_at
      });
    } catch (error) {
      logger.error('Error exchanging token for API key', error);
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  // User info endpoint
  app.get('/api/v1/user', auth, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.apiKey!.user;
      logger.debug(`User info requested for ${user.id}`);
      res.json({
        id: user.id,
        balance: user.balance,
      });
    } catch (error) {
      logger.error('Error fetching user info', error);
      res.status(500).json({ error: 'Failed to fetch user info' });
    }
  });

  // Error handling middleware
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', err);
    
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ 
        error: err.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
