import { Request, Response } from 'express';
import { Database } from './database';
import { AuthenticatedRequest } from './auth';
import { Logger } from './logger';
import { ProxyError, InsufficientBalanceError } from './errors';
import https from 'https';

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

interface OpenRouterMessage {
  role: string;
  content: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: OpenRouterMessage;
    finish_reason?: string;
  }>;
  usage?: OpenRouterUsage;
  model?: string;
}

interface UserInfo {
  id: string;
}

export class OpenRouterProxy {
  private openrouterApiKey: string;
  private database: Database;
  private readonly openrouterHost = 'openrouter.ai';
  private readonly openrouterPath = '/api/v1/chat/completions';
  private logger: Logger;

  constructor(openrouterApiKey: string, database: Database) {
    this.openrouterApiKey = openrouterApiKey;
    this.database = database;
    this.logger = Logger.getInstance();
  }

  async handleRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.apiKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = req.apiKey.user;
    const apiKeyId = req.apiKey.id;

    this.logger.debug(`Proxy request for user ${user.id}, model: ${req.body.model}`);

    // Check balance before proxying
    const currentBalance = await this.database.getUserBalance(user.id);
    if (currentBalance <= 0) {
      res.status(402).json({ error: 'Insufficient balance' });
      return;
    }

    try {
      if (req.headers.accept === 'text/event-stream' || req.body.stream) {
        await this.handleStreamingRequest(req, res, user, apiKeyId);
      } else {
        await this.handleNonStreamingRequest(req, res, user, apiKeyId);
      }
    } catch (error) {
      this.logger.error('Proxy error', error);
      if (!res.headersSent) {
        if (error instanceof InsufficientBalanceError) {
          res.status(402).json({ error: error.message });
        } else if (error instanceof ProxyError) {
          res.status(502).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Proxy request failed' });
        }
      }
    }
  }

  private async handleStreamingRequest(
    req: AuthenticatedRequest,
    res: Response,
    user: UserInfo,
    apiKeyId: string
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    let totalCost = 0;
    let totalTokens = 0;
    let model = '';

    const proxyReq = https.request({
      hostname: this.openrouterHost,
      path: this.openrouterPath,
      method: req.method,
      headers: {
        'Authorization': `Bearer ${this.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://keepai-server',
        'X-Title': 'KeepAI Server',
        ...this.filterHeaders(req.headers)
      }
    });

    proxyReq.on('response', (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        let errorData = '';
        proxyRes.on('data', (chunk) => errorData += chunk);
        proxyRes.on('end', () => {
          res.write(`data: ${JSON.stringify({ error: 'OpenRouter error', details: errorData })}\n\n`);
          res.end();
        });
        return;
      }

      let buffer = '';

      proxyRes.on('data', (chunk) => {
        buffer += chunk.toString();

        // Process complete lines from buffer
        while (true) {
          const lineEnd = buffer.indexOf('\n');
          if (lineEnd === -1) break;

          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);

          // Skip empty lines and comments (starting with ':')
          if (!line || line.startsWith(':')) {
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              res.write('data: [DONE]\n\n');
              // Await billing completion before ending response to prevent data loss
              this.finalizeBilling(user.id, apiKeyId, totalCost, totalTokens, model)
                .then(() => res.end())
                .catch((err) => {
                  this.logger.error('Billing finalization failed', err);
                  res.end();
                });
              return;
            }

            try {
              const parsed = JSON.parse(data);
              if (parsed.usage) {
                const cost = this.calculateCost(parsed.usage);
                totalCost += cost;
                totalTokens += parsed.usage.total_tokens || 0;
              }
              if (parsed.model) {
                model = parsed.model;
              }
            } catch (e) {
              // Log JSON parse errors but continue processing - malformed chunks shouldn't break billing
              this.logger.debug(`JSON parse error in streaming response: ${e}`);
            }
          }
        }

        // Write the original chunk to the response
        res.write(chunk);
      });

      proxyRes.on('end', () => {
        if (!res.headersSent) {
          res.end();
        }
      });

      proxyRes.on('error', (err) => {
        this.logger.error('Proxy response error', err);
        if (!res.headersSent) {
          res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
          res.end();
        }
      });
    });

    proxyReq.on('error', (err) => {
      this.logger.error('Proxy request error', err);
      if (!res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: 'Request failed' })}\n\n`);
        res.end();
      }
    });

    proxyReq.write(JSON.stringify(req.body));
    proxyReq.end();
  }

  private async handleNonStreamingRequest(
    req: AuthenticatedRequest,
    res: Response,
    user: UserInfo,
    apiKeyId: string
  ): Promise<void> {
    const proxyReq = https.request({
      hostname: this.openrouterHost,
      path: this.openrouterPath,
      method: req.method,
      headers: {
        'Authorization': `Bearer ${this.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://keepai-server',
        'X-Title': 'KeepAI Server',
        ...this.filterHeaders(req.headers)
      }
    }, async (proxyRes) => {
      let data = '';
      
      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', async () => {
        try {
          const response: OpenRouterResponse = JSON.parse(data);
          const cost = this.calculateCost(response.usage);
          const tokens = response.usage?.total_tokens || 0;
          const model = response.model || '';

          if (cost > 0) {
            await this.database.deductBalance(user.id, Math.ceil(cost * 1000000));
            await this.database.recordUsage({
              user_id: user.id,
              api_key_id: apiKeyId,
              amount: Math.ceil(cost * 1000000),
              tokens_used: tokens,
              model
            });
          }

          res.status(proxyRes.statusCode || 200);
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (key.toLowerCase() !== 'content-encoding' && value !== undefined) {
              if (typeof value === 'string') {
                res.setHeader(key, value);
              } else if (Array.isArray(value)) {
                res.setHeader(key, value.join(', '));
              }
            }
          }
          res.json(response);
        } catch (error) {
          this.logger.error('Response parsing error', error);
          res.status(proxyRes.statusCode || 500).json({ error: 'Invalid response from upstream' });
        }
      });
    });

    proxyReq.on('error', (err) => {
      this.logger.error('Proxy request error', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Proxy request failed' });
      }
    });

    proxyReq.write(JSON.stringify(req.body));
    proxyReq.end();
  }

  private filterHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const keyLower = key.toLowerCase();
      if (keyLower !== 'authorization' && keyLower !== 'host' && value !== undefined) {
        if (typeof value === 'string') {
          filtered[key] = value;
        } else if (Array.isArray(value)) {
          filtered[key] = value.join(', ');
        }
      }
    }
    return filtered;
  }

  private calculateCost(usage?: OpenRouterUsage): number {
    if (!usage || !usage.cost) {
      // Fallback calculation if cost not provided
      // This is a rough estimate - actual costs vary by model
      const promptTokens = usage?.prompt_tokens || 0;
      const completionTokens = usage?.completion_tokens || 0;
      const totalTokens = usage?.total_tokens || (promptTokens + completionTokens);
      
      // Default to $0.001 per 1K tokens as a rough estimate
      return (totalTokens / 1000) * 0.001;
    }
    return usage.cost;
  }

  private async finalizeBilling(
    userId: string,
    apiKeyId: string,
    cost: number,
    tokens: number,
    model: string
  ): Promise<void> {
    try {
      if (cost > 0) {
        const amountInMicrodollars = Math.ceil(cost * 1000000);
        await this.database.deductBalance(userId, amountInMicrodollars);
        await this.database.recordUsage({
          user_id: userId,
          api_key_id: apiKeyId,
          amount: amountInMicrodollars,
          tokens_used: tokens,
          model
        });
      }
    } catch (error) {
      this.logger.error('Billing finalization error', error);
    }
  }
}
