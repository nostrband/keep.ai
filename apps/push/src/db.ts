import { DBInterface } from '@app/db';
import debug from 'debug';

const debugDb = debug('push:db');

export interface PushSubscription {
  id?: number;
  receiver_pubkey: string;
  sender_pubkey: string;
  web_push_url: string;
  created_at: number;
}

export class PushDatabase {
  constructor(private db: DBInterface) {}

  async initialize(): Promise<void> {
    debugDb('Initializing push database tables');
    
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receiver_pubkey TEXT NOT NULL,
        sender_pubkey TEXT NOT NULL, 
        web_push_url TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(receiver_pubkey, sender_pubkey)
      )
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_receiver_sender 
      ON push_subscriptions (receiver_pubkey, sender_pubkey)
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_sender_receiver
      ON push_subscriptions (sender_pubkey, receiver_pubkey)
    `);

    debugDb('Push database tables initialized');
  }

  async storeSubscription(subscription: Omit<PushSubscription, 'id'>): Promise<void> {
    debugDb('Storing push subscription', {
      receiver: subscription.receiver_pubkey.substring(0, 8),
      sender: subscription.sender_pubkey.substring(0, 8)
    });

    await this.db.exec(`
      INSERT OR REPLACE INTO push_subscriptions 
      (receiver_pubkey, sender_pubkey, web_push_url, created_at)
      VALUES (?, ?, ?, ?)
    `, [
      subscription.receiver_pubkey,
      subscription.sender_pubkey,
      subscription.web_push_url,
      subscription.created_at
    ]);

    debugDb('Push subscription stored');
  }

  async getSubscription(senderPubkey: string, receiverPubkey: string): Promise<PushSubscription | null> {
    debugDb('Getting push subscription', {
      sender: senderPubkey.substring(0, 8),
      receiver: receiverPubkey.substring(0, 8)
    });

    const result = await this.db.execO<PushSubscription>(`
      SELECT * FROM push_subscriptions 
      WHERE sender_pubkey = ? AND receiver_pubkey = ?
    `, [senderPubkey, receiverPubkey]);

    return result?.[0] || null;
  }

  async deleteSubscription(senderPubkey: string, receiverPubkey: string): Promise<void> {
    debugDb('Deleting push subscription', {
      sender: senderPubkey.substring(0, 8),
      receiver: receiverPubkey.substring(0, 8)
    });

    await this.db.exec(`
      DELETE FROM push_subscriptions 
      WHERE sender_pubkey = ? AND receiver_pubkey = ?
    `, [senderPubkey, receiverPubkey]);

    debugDb('Push subscription deleted');
  }

  async deleteSubscriptionByUrl(webPushUrl: string): Promise<void> {
    debugDb('Deleting push subscription by URL');

    await this.db.exec(`
      DELETE FROM push_subscriptions 
      WHERE web_push_url = ?
    `, [webPushUrl]);

    debugDb('Push subscription deleted by URL');
  }
}