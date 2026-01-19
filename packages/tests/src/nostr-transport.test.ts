import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NostrConnector } from '@app/sync';
import { getPublicKey } from 'nostr-tools';

describe('NostrTransport', () => {
  let transport1: NostrConnector;
  let transport2: NostrConnector;

  beforeEach(() => {
    transport1 = new NostrConnector();
    transport2 = new NostrConnector();
  });

  afterEach(() => {
    transport1.close();
    transport2.close();
  });

  it('should generate a valid connection string', async () => {
    const relays = ['wss://relay.damus.io'];
    const connInfo = await transport1.generateConnectionString(relays);

    expect(connInfo).toBeDefined();
    expect(connInfo.key).toBeInstanceOf(Uint8Array);
    expect(connInfo.secret).toMatch(/^[0-9a-f]{32}$/); // 16 bytes as hex
    expect(connInfo.relays).toEqual(relays);
    expect(connInfo.expiration).toBeGreaterThan(Date.now());
    // Match connection string format: nostr+keepai://pubkey?relay=...&secret=...&nonce=...
    // nonce is always present (32 hex chars from 16 random bytes), expiration is not included in URL
    expect(connInfo.str).toMatch(/^nostr\+keepai:\/\/[0-9a-f]{64}\?relay=wss%3A%2F%2Frelay\.damus\.io&secret=[0-9a-f]{32}&nonce=[0-9a-f]{32}$/);
  });

  // Skip: Requires WebSocket which isn't available in Node.js test environment
  it.skip('should establish peer connection between two transports', async () => {
    const relays = ['wss://relay.damus.io'];
    const deviceInfo1 = 'Device 1 - Listener';
    const deviceInfo2 = 'Device 2 - Connector';
    const peer1 = 'peer1';
    const peer2 = 'peer2';

    // Transport 1 generates connection string and starts listening
    const connInfo = await transport1.generateConnectionString(relays);
    
    // Start listening in the background
    const listenerPromise = transport1.listen(connInfo, peer1, deviceInfo1);
    
    // Give a small delay to ensure listener is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Transport 2 connects using the connection string
    const connectorPromise = transport2.connect(connInfo.str, peer2, deviceInfo2);
    
    // Wait for both operations to complete
    const [listenerResult, connectorResult] = await Promise.all([
      listenerPromise,
      connectorPromise
    ]);

    // Verify listener result
    expect(listenerResult).toBeDefined();
    expect(listenerResult.key).toEqual(connInfo.key);
    expect(listenerResult.peer_device_info).toBe(deviceInfo2);
    expect(listenerResult.relays).toEqual(relays);
    expect(listenerResult.peer_pubkey).toMatch(/^[0-9a-f]{64}$/);

    // Verify connector result
    expect(connectorResult).toBeDefined();
    expect(connectorResult.key).toBeInstanceOf(Uint8Array);
    expect(connectorResult.peer_device_info).toBe(deviceInfo1);
    expect(connectorResult.relays).toEqual(relays);
    expect(connectorResult.peer_pubkey).toMatch(/^[0-9a-f]{64}$/);

    // Verify they have each other's pubkeys (swapped because they're peers)
    expect(listenerResult.peer_pubkey).toBe(getPublicKey(connectorResult.key));
    expect(connectorResult.peer_pubkey).toBe(getPublicKey(listenerResult.key));
  }, 60000); // 60 second timeout for network operations

  // Skip: Requires WebSocket which isn't available in Node.js test environment
  it.skip('should reject connection with invalid secret', async () => {
    const relays = ['wss://relay.damus.io'];
    const deviceInfo1 = 'Device 1 - Listener';
    const deviceInfo2 = 'Device 2 - Connector';
    const peer1 = 'peer1';
    const peer2 = 'peer2';

    // Transport 1 generates connection string
    const connInfo = await transport1.generateConnectionString(relays);
    
    // Modify the connection string with wrong secret
    const invalidConnString = connInfo.str.replace(/secret=[0-9a-f]{32}/, 'secret=deadbeefdeadbeefdeadbeefdeadbeef');
    
    // Start listening with a shorter timeout for testing
    const listenerPromise = transport1.listen(connInfo, peer1, deviceInfo1);
    
    // Give a small delay to ensure listener is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Transport 2 tries to connect with invalid secret
    const connectorPromise = transport2.connect(invalidConnString, peer2, deviceInfo2);
    
    // Both should timeout since the secret doesn't match
    await expect(connectorPromise).rejects.toThrow('Connection timeout');
    await expect(listenerPromise).rejects.toThrow('Listen timeout');
  }, 35000); // 35 second timeout (longer than the 30s internal timeout)

  it('should handle multiple relays in connection string', async () => {
    const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
    const connInfo = await transport1.generateConnectionString(relays);

    expect(connInfo.relays).toEqual(relays);
    expect(connInfo.str).toContain('relay=wss%3A%2F%2Frelay.damus.io');
    expect(connInfo.str).toContain('relay=wss%3A%2F%2Fnos.lol');
    expect(connInfo.str).toContain('relay=wss%3A%2F%2Frelay.nostr.band');
  });

  it('should throw error when generating connection string with no relays', async () => {
    await expect(transport1.generateConnectionString([])).rejects.toThrow('At least one relay is required');
  });

  it('should throw error when parsing invalid connection string', async () => {
    const deviceInfo = 'Test Device';
    const peer = 'peer';
    
    await expect(transport2.connect('invalid://connection', peer, deviceInfo)).rejects.toThrow('Invalid connection string format');
    await expect(transport2.connect('nostr+keepai://pubkey', peer, deviceInfo)).rejects.toThrow('Invalid connection string: missing required parameters');
  });
});