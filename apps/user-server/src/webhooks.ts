import { Webhook } from 'svix';
import { Request, Response } from 'express';
import { Database } from './database';
import { Logger } from './logger';

export function createWebhookHandler(database: Database) {
  const logger = Logger.getInstance();
  const webhookSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;

  if (!webhookSecret) {
    logger.warn('CLERK_WEBHOOK_SIGNING_SECRET is not set. Webhooks will fail verification.');
  }

  return async (req: Request, res: Response) => {
    if (!webhookSecret) {
      logger.error('Webhook received but CLERK_WEBHOOK_SIGNING_SECRET is not configured');
      return res.status(500).json({ error: 'Webhook configuration error' });
    }

    const svix_id = req.headers["svix-id"] as string;
    const svix_timestamp = req.headers["svix-timestamp"] as string;
    const svix_signature = req.headers["svix-signature"] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
      logger.warn('Missing svix headers');
      return res.status(400).json({ error: 'Missing svix headers' });
    }

    let payload: string | Buffer = req.body;
    
    // Ensure payload is a Buffer or string for verification
    if (typeof payload === 'object' && !(payload instanceof Buffer)) {
        // This likely means express.json() has already parsed it.
        // We cannot verify signature easily if we lost the raw body.
        // However, if we configured the route correctly, req.body should be a Buffer.
        logger.error('Webhook payload is already parsed object. Raw body required for verification.');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    const wh = new Webhook(webhookSecret);
    let evt: any;

    try {
      evt = wh.verify(payload, {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      });
    } catch (err) {
      logger.error('Webhook verification failed', err);
      return res.status(400).json({ error: 'Webhook verification failed' });
    }

    const eventType = evt.type;
    logger.info(`Received webhook: ${eventType}`);

    try {
      if (eventType === 'user.created') {
        const { id } = evt.data;
        // Check if user exists
        const existing = await database.getUserByAuthId(id);
        if (!existing) {
             // Set initial balance to 10 USD (10,000,000 microdollars)
             const user = await database.createUser(id, 10000000);
             // Create API Key
             const { apiKey } = await database.createApiKey(user.id, 'Default Key');
             logger.info(`Created user ${id} with $10 initial balance and API key.`);
        } else {
            logger.info(`User ${id} already exists.`);
        }
      } else if (eventType === 'user.deleted') {
        const { id } = evt.data;
        await database.deleteUser(id);
        logger.info(`Deleted user ${id}`);
      }
      
      res.json({ received: true });
    } catch (err) {
      logger.error(`Error handling webhook ${eventType}`, err);
      res.status(500).json({ error: 'Error processing webhook' });
    }
  };
}
