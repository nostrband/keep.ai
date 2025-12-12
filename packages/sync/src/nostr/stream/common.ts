/**
 * Common helper functions for NIP-173 streaming
 */

import { Event, UnsignedEvent, getPublicKey, finalizeEvent, validateEvent, verifyEvent } from 'nostr-tools';

/**
 * Creates a signed Nostr event
 *
 * @param kind - Event kind
 * @param content - Event content
 * @param tags - Event tags
 * @param privkey - Private key to sign with
 * @returns Signed Nostr event
 */
export function createEvent(
  kind: number,
  content: string,
  tags: string[][],
  privkey: Uint8Array
): Event {
  const unsignedEvent: UnsignedEvent = {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
    pubkey: getPublicKey(privkey),
  };

  return finalizeEvent(unsignedEvent, privkey);
}

/**
 * Validates a Nostr event
 * 
 * @param event - The event to validate
 * @returns True if the event is valid, false otherwise
 */
export function validateNostrEvent(event: Event): boolean {
  try {
    // Check event structure
    const isValidStructure = validateEvent(event);
    if (!isValidStructure) {
      return false;
    }

    // Verify signature
    const isValidSignature = verifyEvent(event);
    if (!isValidSignature) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Default relays for keep.ai
 */
export const DEFAULT_RELAYS = [
  'wss://relay1.getkeep.ai',
  'wss://relay2.getkeep.ai'
];

/**
 * Publishes an event to multiple relays using SimplePool
 * 
 * @param event - Event to publish
 * @param relays - Relay URLs
 * @param pool - SimplePool instance
 * @returns Promise resolving to successful relay URLs
 */
export async function publishToRelays(
  event: Event,
  relays: string[],
  pool: any // SimplePool
): Promise<string[]> {
  let c = 0;
  const successfulRelays: string[] = [];
  
  // Make sure we see notices
  for (const r of relays) {
    const relay = await pool.ensureRelay(r);
    relay.onnotice = (msg: string) => console.log("NOTICE: ", msg);
    relay.publishTimeout = 10000;
  }
  
  // Publish in parallel
  const results = await Promise.allSettled(pool.publish(relays, event));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      c++;
      successfulRelays.push(relays[i]);
    } else {
      console.error("Publish error", r.reason);
    }
  }
  
  if (!c) {
    throw new Error(
      "Failed to publish event " + event.id + " to relays " + relays.join(', ')
    );
  }
  
  return successfulRelays;
}