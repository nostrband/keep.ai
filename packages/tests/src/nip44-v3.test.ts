import { describe, it, expect } from 'vitest';
import { nip44_v3 } from '@app/sync';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { base64 } from '@scure/base';

type KeyPair = {
  priv: Uint8Array;
  pub: string;
};

const MAX_MESSAGE_BYTES = 0xfffff;

function createKeyPair(): KeyPair {
  const priv = generateSecretKey();
  const pub = getPublicKey(priv);
  return { priv, pub };
}

function deriveSharedKeys(): {
  alice: KeyPair;
  bob: KeyPair;
  keyAB: Uint8Array;
  keyBA: Uint8Array;
} {
  const alice = createKeyPair();
  const bob = createKeyPair();
  const keyAB = nip44_v3.getConversationKey(alice.priv, bob.pub);
  const keyBA = nip44_v3.getConversationKey(bob.priv, alice.pub);
  return { alice, bob, keyAB, keyBA };
}

describe('nip44_v3 encryption', () => {
  it('produces identical conversation keys and decrypts messages symmetrically', () => {
    const { keyAB, keyBA } = deriveSharedKeys();
    const message = 'Hello from nostr nip44 v3';

    const ciphertext = nip44_v3.encrypt(message, keyAB);
    const decrypted = nip44_v3.decrypt(ciphertext, keyBA);

    expect(keyAB.length).toBe(32);
    expect(keyBA.length).toBe(32);
    expect(keyAB).toEqual(keyBA);
    expect(decrypted).toBe(message);
  });

  it('rejects tampered ciphertext by validating MAC integrity', () => {
    const { keyAB, keyBA } = deriveSharedKeys();
    const message = 'Integrity check payload';

    const ciphertext = nip44_v3.encrypt(message, keyAB);
    const bytes = base64.decode(ciphertext);
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = base64.encode(bytes);

    expect(() => nip44_v3.decrypt(tampered, keyBA)).toThrowError(/invalid MAC/);
  });

  it('handles encrypt/decrypt cycle for minimum (1 byte) plaintext', () => {
    const { keyAB, keyBA } = deriveSharedKeys();
    const message = 'A';

    const ciphertext = nip44_v3.encrypt(message, keyAB);
    const decrypted = nip44_v3.decrypt(ciphertext, keyBA);

    expect(decrypted).toBe(message);
    expect(decrypted.length).toBe(1);
  });

  it(
    'handles encrypt/decrypt cycle for maximum plaintext length',
    () => {
      const { keyAB, keyBA } = deriveSharedKeys();
      const message = 'x'.repeat(MAX_MESSAGE_BYTES);

      const ciphertext = nip44_v3.encrypt(message, keyAB);
      const decrypted = nip44_v3.decrypt(ciphertext, keyBA);

      expect(decrypted).toBe(message);
      expect(decrypted.length).toBe(MAX_MESSAGE_BYTES);
    },
    20000,
  );
});