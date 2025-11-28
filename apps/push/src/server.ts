import { SimplePool, Event, getPublicKey } from 'nostr-tools';
import { nip44_v3 } from '@app/sync';
import { createDBNode } from '@app/node';
import { PushDatabase } from './db.js';
import webpush from 'web-push';
import debug from 'debug';
import { hexToBytes } from 'nostr-tools/utils';

const debugServer = debug('push:server');

// Event kinds for push notifications
const KIND_SUBSCRIBE = 24681;
const KIND_PUSH = 24682;

const DB_FILE = './push-server.db';

// Web push response codes that indicate invalid/expired subscriptions
const INVALID_SUBSCRIPTION_CODES = [
  410, // Gone
  413, // Payload Too Large (some endpoints use this for expired)
  400, // Bad Request (malformed endpoint)
  404, // Not Found
];

interface QueuedPush {
  webPushUrl: string;
  payload: string;
  timestamp: number;
}

interface RateLimitInfo {
  domain: string;
  retryAfter: number; // timestamp when we can retry
  queuedPushes: QueuedPush[];
}

interface SubscribeEventContent {
  sender_pubkey: string;
  web_push_url: string;
}

interface PushEventContent {
  receiver_pubkey: string;
  payload: string;
}

export class PushServer {
  private pool: SimplePool = new SimplePool();
  private db!: PushDatabase;
  private serverPrivkey: Uint8Array;
  private serverPubkey: string;
  private relays: string[];
  private dbInstance: any;
  private rateLimitedDomains: Map<string, RateLimitInfo> = new Map();
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(serverPrivkeyHex: string, relays: string[], email: string, vapidPublicKey: string, vapidPrivateKey: string) {
    this.serverPrivkey = hexToBytes(serverPrivkeyHex);
    this.serverPubkey = getPublicKey(this.serverPrivkey);
    this.relays = relays;
    
    // Set VAPID details for web push
    webpush.setVapidDetails(
      email,
      vapidPublicKey,
      vapidPrivateKey
    );
    
    debugServer('Push server initialized', {
      pubkey: this.serverPubkey,
      relays: this.relays,
      vapidConfigured: !!(email && vapidPublicKey && vapidPrivateKey)
    });
  }

  async start(): Promise<void> {
    debugServer('Starting push server...');

    // Initialize database
    this.dbInstance = await createDBNode(DB_FILE);
    this.db = new PushDatabase(this.dbInstance);
    await this.db.initialize();

    // Subscribe to push notification events for our pubkey
    const filter = {
      kinds: [KIND_SUBSCRIBE, KIND_PUSH],
      '#p': [this.serverPubkey],
    };

    debugServer('Subscribing to events with filter:', filter);

    this.pool.subscribeMany(this.relays, filter, {
      onevent: async (event: Event) => {
        try {
          await this.handleEvent(event);
        } catch (error) {
          debugServer('Error handling event:', error);
        }
      },
      oneose: () => {
        debugServer('End of stored events received');
      },
      onclose: (reasons: string[]) => {
        debugServer('Subscription closed:', reasons);
      }
    });

    debugServer('Push server started successfully');
  }

  private async handleEvent(event: Event): Promise<void> {
    debugServer('Received event', {
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey.substring(0, 8)
    });

    // Check if event tags our pubkey with 'p'
    const pTags = event.tags.filter(tag => tag[0] === 'p' && tag[1] === this.serverPubkey);
    if (pTags.length === 0) {
      debugServer('Event does not tag our pubkey, ignoring');
      return;
    }

    if (event.kind === KIND_SUBSCRIBE) {
      await this.handleSubscribeEvent(event);
    } else if (event.kind === KIND_PUSH) {
      await this.handlePushEvent(event);
    } else {
      debugServer('Unknown event kind:', event.kind);
    }
  }

  private async handleSubscribeEvent(event: Event): Promise<void> {
    debugServer('Handling subscribe event from', event.pubkey.substring(0, 8));

    try {
      // Decrypt content using NIP-44
      const conversationKey = nip44_v3.getConversationKey(this.serverPrivkey, event.pubkey);
      const decryptedContent = nip44_v3.decrypt(event.content, conversationKey);
      
      const content: SubscribeEventContent = JSON.parse(decryptedContent);
      
      debugServer('Decrypted subscribe content:', {
        sender: content.sender_pubkey.substring(0, 8),
        hasUrl: !!content.web_push_url
      });

      // Validate content structure
      if (!content.sender_pubkey || !content.web_push_url) {
        debugServer('Invalid subscribe content structure');
        return;
      }

      // Store subscription in database
      await this.db.storeSubscription({
        receiver_pubkey: event.pubkey, // The receiver is the one who sent this subscribe event
        sender_pubkey: content.sender_pubkey, // The sender who can send push notifications
        web_push_url: content.web_push_url,
        created_at: event.created_at
      });

      debugServer('Subscription stored successfully');
    } catch (error) {
      debugServer('Error handling subscribe event:', error);
    }
  }

  private async handlePushEvent(event: Event): Promise<void> {
    debugServer('Handling push event from', event.pubkey.substring(0, 8));

    try {
      // Decrypt content using NIP-44
      const conversationKey = nip44_v3.getConversationKey(this.serverPrivkey, event.pubkey);
      const decryptedContent = nip44_v3.decrypt(event.content, conversationKey);
      
      const content: PushEventContent = JSON.parse(decryptedContent);
      
      debugServer('Decrypted push content:', {
        receiver: content.receiver_pubkey.substring(0, 8),
        payloadLength: content.payload?.length || 0
      });

      // Validate content structure
      if (!content.receiver_pubkey || !content.payload) {
        debugServer('Invalid push content structure');
        return;
      }

      // Find subscription by sender+receiver pubkeys
      const subscription = await this.db.getSubscription(event.pubkey, content.receiver_pubkey);
      if (!subscription) {
        debugServer('No subscription found for sender/receiver pair');
        return;
      }

      debugServer('Found subscription, sending web push notification');

      // Send web push notification
      await this.sendWebPushNotification(subscription.web_push_url, content.payload);

      debugServer('Web push notification sent successfully');
    } catch (error) {
      debugServer('Error handling push event:', error);
    }
  }

  private async sendWebPushNotification(webPushUrl: string, payload: string): Promise<void> {
    const domain = this.extractDomain(webPushUrl);

    // Check if this domain is rate limited
    if (this.isDomainRateLimited(domain)) {
      debugServer('Domain is rate limited, queueing push:', domain);
      this.queuePushForDomain(domain, webPushUrl, payload);
      return;
    }

    try {
      debugServer('Sending web push to domain:', domain);

      // Parse the web push subscription
      const subscription = JSON.parse(webPushUrl);
      
      // Send the notification with the payload as-is
      await webpush.sendNotification(subscription, payload);

      debugServer('Web push sent successfully');
    } catch (error: any) {
      debugServer('Web push error:', {
        statusCode: error.statusCode,
        message: error.message?.substring(0, 200),
        domain
      });

      // Handle rate limiting (429)
      if (error.statusCode === 429) {
        this.handleRateLimit(domain, error.headers, webPushUrl, payload);
        return;
      }

      // Check if this is an invalid/expired subscription error
      if (error.statusCode && INVALID_SUBSCRIPTION_CODES.includes(error.statusCode)) {
        debugServer('Subscription appears invalid/expired, removing from database');
        await this.db.deleteSubscriptionByUrl(webPushUrl);
      }

      throw error;
    }
  }

  private extractDomain(webPushUrl: string): string {
    try {
      const subscription = JSON.parse(webPushUrl);
      const url = new URL(subscription.endpoint);
      return url.hostname;
    } catch (error) {
      debugServer('Error extracting domain from web push URL:', error);
      return 'unknown';
    }
  }

  private isDomainRateLimited(domain: string): boolean {
    const rateLimitInfo = this.rateLimitedDomains.get(domain);
    if (!rateLimitInfo) return false;

    const now = Date.now();
    if (now >= rateLimitInfo.retryAfter) {
      // Rate limit has expired, remove it
      this.rateLimitedDomains.delete(domain);
      return false;
    }

    return true;
  }

  private queuePushForDomain(domain: string, webPushUrl: string, payload: string): void {
    const rateLimitInfo = this.rateLimitedDomains.get(domain);
    if (rateLimitInfo) {
      rateLimitInfo.queuedPushes.push({
        webPushUrl,
        payload,
        timestamp: Date.now()
      });
      debugServer('Queued push for domain:', {
        domain,
        queueLength: rateLimitInfo.queuedPushes.length
      });
    }
  }

  private handleRateLimit(domain: string, headers: any, webPushUrl: string, payload: string): void {
    const retryAfterHeader = headers?.['retry-after'];
    let retryAfterMs = 0;

    if (retryAfterHeader) {
      // Check if it's a number (seconds) or a date string
      if (/^\d+$/.test(retryAfterHeader)) {
        // It's seconds
        retryAfterMs = parseInt(retryAfterHeader) * 1000;
      } else {
        // It's a date string
        try {
          const retryDate = new Date(retryAfterHeader);
          retryAfterMs = retryDate.getTime() - Date.now();
        } catch (error) {
          debugServer('Error parsing Retry-After date:', retryAfterHeader);
          // Default to 5 minutes if we can't parse it
          retryAfterMs = 5 * 60 * 1000;
        }
      }
    } else {
      // No Retry-After header, default to 5 minutes
      retryAfterMs = 5 * 60 * 1000;
    }

    // Ensure minimum delay of 1 minute
    retryAfterMs = Math.max(retryAfterMs, 60 * 1000);

    const retryAfterTimestamp = Date.now() + retryAfterMs;

    debugServer('Rate limited by domain:', {
      domain,
      retryAfterMs,
      retryAfterTimestamp: new Date(retryAfterTimestamp).toISOString()
    });

    // Store rate limit info
    const rateLimitInfo: RateLimitInfo = {
      domain,
      retryAfter: retryAfterTimestamp,
      queuedPushes: [{
        webPushUrl,
        payload,
        timestamp: Date.now()
      }]
    };

    this.rateLimitedDomains.set(domain, rateLimitInfo);

    // Clear any existing timer for this domain
    const existingTimer = this.retryTimers.get(domain);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set up retry timer
    const timer = setTimeout(() => {
      this.retryQueuedPushes(domain);
    }, retryAfterMs);

    this.retryTimers.set(domain, timer);
  }

  private async retryQueuedPushes(domain: string): Promise<void> {
    const rateLimitInfo = this.rateLimitedDomains.get(domain);
    if (!rateLimitInfo) return;

    debugServer('Retrying queued pushes for domain:', {
      domain,
      queueLength: rateLimitInfo.queuedPushes.length
    });

    // Remove rate limit
    this.rateLimitedDomains.delete(domain);
    this.retryTimers.delete(domain);

    // Process queued pushes
    for (const queuedPush of rateLimitInfo.queuedPushes) {
      try {
        await this.sendWebPushNotification(queuedPush.webPushUrl, queuedPush.payload);
      } catch (error) {
        debugServer('Error retrying queued push:', error);
        // Individual failures shouldn't stop the queue processing
      }
    }
  }

  async stop(): Promise<void> {
    debugServer('Stopping push server...');
    
    this.pool.destroy();
    
    // Clear all retry timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.rateLimitedDomains.clear();
    
    if (this.dbInstance) {
      await this.dbInstance.close();
    }

    debugServer('Push server stopped');
  }
}