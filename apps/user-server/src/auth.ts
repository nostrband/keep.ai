import { Request, Response, NextFunction } from 'express';
import { Database } from './database';
import { AuthenticationError } from './errors';
import { Logger } from './logger';

export interface AuthenticatedRequest extends Request {
  apiKey?: {
    id: string;
    user_id: string;
    user: {
      id: string;
      auth_user_id: string;
      balance: number;
    };
  };
}

const logger = Logger.getInstance();

export function createAuthMiddleware(database: Database) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const apiKey = authHeader.substring(7);
    const crypto = require('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    try {
      const keyData = await database.findApiKey(keyHash);
      if (!keyData) {
        logger.warn(`Invalid API key attempted: ${keyHash.substring(0, 8)}...`);
        throw new AuthenticationError('Invalid or expired API key');
      }

      req.apiKey = {
        id: keyData.id,
        user_id: keyData.user_id,
        user: keyData.user
      };

      await database.updateApiKeyLastUsed(keyData.id);
      logger.debug(`API key authenticated successfully for user ${keyData.user.id}`);
      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return res.status(401).json({ error: error.message });
      }
      logger.error('Authentication error', error);
      return res.status(500).json({ error: 'Authentication failed' });
    }
  };
}
