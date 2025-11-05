import { Event, finalizeEvent, UnsignedEvent } from "nostr-tools";
import { nip44_v3, NostrSigner } from "@app/sync";

// Simple NostrSigner implementation for serverless shared worker
export class ServerlessNostrSigner implements NostrSigner {
  private key?: Uint8Array;

  setKey(key: Uint8Array) {
    this.key = key;
  }

  async signEvent(event: UnsignedEvent): Promise<Event> {
    if (!this.key) throw new Error("No key set for signing");
    return finalizeEvent(event, this.key);
  }

  async encrypt(req: {
    plaintext: string;
    receiverPubkey: string;
    senderPubkey: string;
  }): Promise<string> {
    if (!this.key) throw new Error("No key set for encryption");
    const conversationKey = nip44_v3.getConversationKey(
      this.key,
      req.receiverPubkey
    );
    return nip44_v3.encrypt(req.plaintext, conversationKey);
  }

  async decrypt(req: {
    ciphertext: string;
    receiverPubkey: string;
    senderPubkey: string;
  }): Promise<string> {
    if (!this.key) throw new Error("No key set for decryption");
    const conversationKey = nip44_v3.getConversationKey(
      this.key,
      req.senderPubkey
    );
    return nip44_v3.decrypt(req.ciphertext, conversationKey);
  }
}

