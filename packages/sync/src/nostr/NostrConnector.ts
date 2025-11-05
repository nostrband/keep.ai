import {
  SimplePool,
  generateSecretKey,
  getPublicKey,
  Event,
  Filter,
  finalizeEvent,
} from "nostr-tools";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { SubCloser } from "nostr-tools/abstract-pool";
import debug from "debug";
import { KIND_CONNECT, publish } from ".";
import { nip44_v3 } from "./nip44-v3";

// Constants
const CONN_STRING_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds
const CONNECTION_TIMEOUT = 30 * 1000; // 30 seconds in milliseconds

// Interfaces
export interface ConnectionStringInfo {
  key: Uint8Array;
  secret: string;
  nonce: string;
  relays: string[];
  expiration: number;
  str: string;
}

export interface NostrPeerInfo {
  key: Uint8Array;
  peer_pubkey: string;
  peer_id: string;
  peer_device_info: string;
  relays: string[];
}

interface ConnectPayload {
  secret: string;
  peer_id: string;
  device_info: string;
}

interface ReplyPayload {
  success: boolean;
  peer_id: string;
  device_info: string;
}

const debugNostrConnector = debug("sync:NostrConnector");

export class NostrConnector {

  private pool: SimplePool = new SimplePool();

  /**
   * Generate a connection string for peer discovery
   */
  async generateConnectionString(
    relays: string[],
    key?: Uint8Array,
  ): Promise<ConnectionStringInfo> {
    if (!relays || relays.length === 0) {
      throw new Error("At least one relay is required");
    }

    key = key || generateSecretKey();
    const pubkey = getPublicKey(key);
    const secret = bytesToHex(randomBytes(16));
    const nonce = bytesToHex(randomBytes(16));
    const expiration = Date.now() + CONN_STRING_TTL;

    // Build the connection string
    const relayParams = relays
      .map((relay) => `relay=${encodeURIComponent(relay)}`)
      .join("&");
    const str = `nostr+keepai://${pubkey}?${relayParams}&secret=${secret}&nonce=${nonce}`;

    return {
      key,
      secret,
      nonce,
      relays,
      expiration,
      str,
    };
  }

  /**
   * Connect to a peer using a connection string
   */
  async connect(
    connString: string,
    localPeerId: string,
    deviceInfo: string,
    key?: Uint8Array
  ): Promise<NostrPeerInfo> {
    // Parse the connection string
    const parsed = this.parseConnectionString(connString);
    const { peerPubkey, relays, secret, nonce } = parsed;

    // Generate our own key
    key = key || generateSecretKey();
    const ourPubkey = getPublicKey(key);

    // Create the connection payload
    const payload: ConnectPayload = {
      secret,
      peer_id: localPeerId,
      device_info: deviceInfo,
    };

    // Encrypt the payload
    const conversationKey = nip44_v3.getConversationKey(key, peerPubkey);
    const encryptedContent = nip44_v3.encrypt(
      JSON.stringify(payload),
      conversationKey
    );

    // Create the nostr event
    const event: Event = {
      kind: KIND_CONNECT,
      pubkey: ourPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["n", nonce]],
      content: encryptedContent,
      id: "",
      sig: "",
    };

    // Sign the event (this will set id and sig)
    const signedEvent = finalizeEvent(event, key);

    // Subscribe for replies before publishing the request
    const filter: Filter = {
      kinds: [KIND_CONNECT],
      authors: [peerPubkey],
    };

    const result = new Promise<NostrPeerInfo>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => {
          if (sub) {
            sub.close();
            sub = undefined;
          }
          timeout = undefined;
          reject(new Error("Connection timeout: no response from peer"));
        },
        // Short wait, getting req/reply over relay should be fast
        CONNECTION_TIMEOUT
      );

      let sub: SubCloser | undefined = this.pool.subscribeMany(relays, filter, {
        onevent: async (event) => {
          try {
            // Decrypt the response
            const conversationKey = nip44_v3.getConversationKey(key, peerPubkey);
            const decryptedContent = nip44_v3.decrypt(
              event.content,
              conversationKey
            );
            const replyPayload: ReplyPayload = JSON.parse(decryptedContent);

            if (sub) sub.close();
            sub = undefined;
            if (timeout) clearTimeout(timeout);
            timeout = undefined;

            if (replyPayload.success) {
              resolve({
                key,
                peer_pubkey: peerPubkey,
                peer_id: replyPayload.peer_id,
                peer_device_info: replyPayload.device_info,
                relays,
              });
            } else {
              reject(new Error("Peer rejected the connection"));
            }
          } catch (error) {
            // Ignore decryption errors (might be for someone else)
            console.warn("Failed to decrypt event:", error);
          }
        },
        oneose: () => {
          // End of stored events, continue listening
        },
      });
    });

    // Publish the event to relays, we're ready to get replies
    await publish(signedEvent, this.pool, relays);

    // Result of the sub
    return result;
  }

  /**
   * Listen for incoming connections
   */
  async listen(
    info: ConnectionStringInfo,
    localPeerId: string,
    deviceInfo: string,
    abort?: Promise<void>
  ): Promise<NostrPeerInfo> {
    const ourPubkey = getPublicKey(info.key);

    // Subscribe for connection requests
    const filter: Filter = {
      kinds: [KIND_CONNECT],
      "#n": [info.nonce],
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    return new Promise((resolve, reject) => {

      // Aborter
      abort?.then(() => reject("Aborted"));

      // Subscription
      let sub: SubCloser | undefined = this.pool.subscribeMany(
        info.relays,
        filter,
        {
          onevent: async (event) => {
            try {
              // Decrypt the incoming request
              const conversationKey = nip44_v3.getConversationKey(
                info.key,
                event.pubkey
              );
              const decryptedContent = nip44_v3.decrypt(
                event.content,
                conversationKey
              );
              const connectPayload: ConnectPayload =
                JSON.parse(decryptedContent);

              // Verify the secret (anti-spoof check)
              if (connectPayload.secret === info.secret) {
                // Valid connection request, send reply
                const replyPayload: ReplyPayload = {
                  success: true,
                  peer_id: localPeerId,
                  device_info: deviceInfo,
                };

                // Reuse same conversation key
                const encryptedReply = nip44_v3.encrypt(
                  JSON.stringify(replyPayload),
                  conversationKey
                );

                const replyEvent: Event = {
                  kind: KIND_CONNECT,
                  pubkey: ourPubkey,
                  created_at: Math.floor(Date.now() / 1000),
                  tags: [],
                  content: encryptedReply,
                  id: "",
                  sig: "",
                };

                const signedReply = finalizeEvent(replyEvent, info.key);

                // Publish the reply
                await publish(signedReply, this.pool, info.relays);

                if (timeout) {
                  clearTimeout(timeout);
                  timeout = undefined;
                }
                if (sub) sub.close();
                resolve({
                  key: info.key,
                  peer_pubkey: event.pubkey,
                  peer_id: connectPayload.peer_id,
                  peer_device_info: connectPayload.device_info,
                  relays: info.relays,
                });
              }
            } catch (error) {
              // Ignore decryption errors (might be for someone else)
              console.warn("Failed to decrypt event:", error);
            }
          },
          oneose: () => {
            // End of stored events, continue listening
          },
        }
      );

      // Set up timeout for listening
      timeout = setTimeout(() => {
        timeout = undefined;
        if (sub) {
          sub.close();
          sub = undefined;
        }
        reject(
          new Error("Listen timeout: no valid connection requests received")
        );

        // Wait for full expiration period,
        // it might take long to scan QR code and start connecting
      }, info.expiration - Date.now());
    });
  }

  /**
   * Parse a nostr+keepai connection string
   */
  private parseConnectionString(connString: string): {
    peerPubkey: string;
    relays: string[];
    secret: string;
    nonce: string;
  } {
    if (!connString.startsWith("nostr+keepai://")) {
      throw new Error("Invalid connection string format");
    }

    const url = new URL(connString);
    // Safari parses it into pathname as //pubkey
    const peerPubkey = url.hostname || url.pathname.split("//")[1];

    const relays: string[] = [];
    const relayParams = url.searchParams.getAll("relay");
    relays.push(...relayParams);

    const secret = url.searchParams.get("secret");
    const nonce = url.searchParams.get("nonce");

    if (!peerPubkey || relays.length === 0 || !secret || !nonce) {
      throw new Error("Invalid connection string: missing required parameters");
    }

    return { peerPubkey, relays, secret, nonce };
  }

  /**
   * Close the transport and cleanup resources
   */
  close(): void {
    this.pool.destroy();
  }
}
