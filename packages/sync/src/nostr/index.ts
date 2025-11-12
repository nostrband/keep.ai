import { Event, SimplePool } from "nostr-tools";

// Connection establishment
export const KIND_CONNECT = 24680;

// Sync request
export const KIND_CURSOR = 14680;

// Changes (payload)
export const KIND_CHANGES = 4680;

export * from "./NostrConnector";
export * from "./NostrTransport";
export * from "./nip44-v3";

export async function publish(
  event: Event,
  pool: SimplePool,
  relays: string[]
) {
  let c = 0;
  // Make sure we see notices
  for (const r of relays) {
    const relay = await pool.ensureRelay(r);
    relay.onnotice = (msg) => console.log("NOTICE: ", msg);
    relay.publishTimeout = 10000;
  }
  // Publish in parallel
  const results = await Promise.allSettled(pool.publish(relays, event));
  for (const r of results) {
    if (r.status === "fulfilled") c++;
    else console.error("Publish error", r.reason);
  }
  if (!c)
    throw new Error(
      "Failed to publish event " + event.id + " to relays " + relays
    );
}
