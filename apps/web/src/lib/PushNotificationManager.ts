import { UnsignedEvent, Event as NostrEvent, finalizeEvent, SimplePool } from 'nostr-tools';
import { ServerlessNostrSigner } from '../ui/lib/signer';
import { NostrPeer } from '@app/db';
import { publish } from '@app/sync';
import debug from 'debug';

const dbg = debug('PushNotificationManager');

export class PushNotificationManager {
  private signer: ServerlessNostrSigner;
  private pushServerPubkey: string;
  private pushRelays: string[];
  private pool: SimplePool;

  constructor(signer: ServerlessNostrSigner) {
    this.signer = signer;
    
    // Get environment variables
    this.pushServerPubkey = (import.meta as any).env?.VITE_PUSH_SERVER_PUBKEY || '';
    this.pushRelays = ((import.meta as any).env?.VITE_PUSH_RELAYS || '').split(',').filter(Boolean);
    
    if (!this.pushServerPubkey) {
      throw new Error('VITE_PUSH_SERVER_PUBKEY environment variable is required');
    }
    
    if (this.pushRelays.length === 0) {
      throw new Error('VITE_PUSH_RELAYS environment variable is required');
    }

    // Initialize SimplePool for publishing
    this.pool = new SimplePool();
  }

  async setupPushNotifications(peers: NostrPeer[]): Promise<void> {
    try {
      dbg('Setting up push notifications...');
      
      // Request push permission if not granted
      const permission = await this.requestPushPermission();
      if (permission !== 'granted') {
        dbg('Push permission not granted:', permission);
        return;
      }

      // Get or create push subscription
      const subscription = await this.getOrCreatePushSubscription();
      if (!subscription) {
        dbg('Failed to create push subscription');
        return;
      }

      dbg('Got push subscription:', subscription);

      // Find sender pubkey from peers
      const senderPubkey = this.findSenderPubkey(peers);
      if (!senderPubkey) {
        dbg('No sender pubkey found in peers');
        return;
      }

      dbg('Found sender pubkey:', senderPubkey);

      // Create and send 24681 subscribe event
      await this.sendSubscribeEvent(subscription, senderPubkey);
      
      // Store config for service worker
      await this.storePushConfigForServiceWorker(senderPubkey);
      
      dbg('Push notification setup complete');
      
    } catch (error) {
      console.error('Error setting up push notifications:', error);
    }
  }

  private async requestPushPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      throw new Error('This browser does not support notifications');
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission === 'denied') {
      return 'denied';
    }

    return await Notification.requestPermission();
  }

  private async getOrCreatePushSubscription(): Promise<PushSubscription | null> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('Push messaging is not supported');
    }

    // Wait for service worker to be ready
    const registration = await navigator.serviceWorker.ready;
    
    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      // Create new subscription
      const applicationServerKey = this.urlBase64ToUint8Array(this.getVapidPublicKey());
      
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
    }

    return subscription;
  }

  private findSenderPubkey(peers: NostrPeer[]): string | null {
    const signerPubkey = this.signer.pubkey();
    
    // Find a peer where local_pubkey matches signer.pubkey()
    const peer = peers.find(p => p.local_pubkey === signerPubkey);
    
    return peer?.peer_pubkey || null;
  }

  private async sendSubscribeEvent(subscription: PushSubscription, senderPubkey: string): Promise<void> {
    try {
      // Create the subscribe event content
      const subscriptionData = {
        sender_pubkey: senderPubkey,
        web_push_url: JSON.stringify(subscription)
      };

      // Encrypt the content
      const encryptedContent = await this.signer.encrypt({
        plaintext: JSON.stringify(subscriptionData),
        receiverPubkey: this.pushServerPubkey,
        senderPubkey: this.signer.pubkey()
      });

      // Create the unsigned event
      const unsignedEvent: UnsignedEvent = {
        kind: 24681,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['p', this.pushServerPubkey]
        ],
        content: encryptedContent,
        pubkey: this.signer.pubkey()
      };

      // Sign the event
      const signedEvent = await this.signer.signEvent(unsignedEvent);

      dbg('Sending 24681 subscribe event:', signedEvent);

      // Send to push server relays
      await this.publishEventToRelays(signedEvent);
      
    } catch (error) {
      console.error('Error sending subscribe event:', error);
      throw error;
    }
  }

  private async publishEventToRelays(event: NostrEvent): Promise<void> {
    try {
      await publish(event, this.pool, this.pushRelays);
      dbg('Published 24681 subscribe event to relays:', this.pushRelays);
    } catch (error) {
      console.error('Error publishing to relays:', error);
      throw error;
    }
  }

  private async storePushConfigForServiceWorker(senderPubkey: string): Promise<void> {
    try {
      // Store config in IndexedDB for service worker to access
      const db = await this.openPushConfigDB();
      const transaction = db.transaction(['config'], 'readwrite');
      const store = transaction.objectStore('config');
      
      const signerKey = this.signer.privkey(); // Get private key properly
      
      await store.put({
        id: 'push-config',
        senderPubkey,
        privateKey: Array.from(signerKey) // Convert Uint8Array to regular array for storage
      });
      
      dbg('Stored push config for service worker');
    } catch (error) {
      console.error('Error storing push config:', error);
    }
  }

  private openPushConfigDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('keep-ai-push-config', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'id' });
        }
      };
    });
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  private getVapidPublicKey(): string {
    // This would come from environment variable in production
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      throw new Error('VITE_VAPID_PUBLIC_KEY environment variable is required');
    }
    return vapidKey;
  }
}