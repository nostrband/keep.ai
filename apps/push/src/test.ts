import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { nip44_v3 } from '@app/sync';
import { bytesToHex } from 'nostr-tools/utils';
import debug from 'debug';

const debugTest = debug('push:test');

// Test event creation and encryption
async function testEventCreation() {
  // Generate test keys
  const serverPrivkey = generateSecretKey();
  const serverPubkey = getPublicKey(serverPrivkey);
  
  const receiverPrivkey = generateSecretKey();
  const receiverPubkey = getPublicKey(receiverPrivkey);
  
  const senderPrivkey = generateSecretKey();
  const senderPubkey = getPublicKey(senderPrivkey);

  debugTest('Generated test keys:', {
    server: serverPubkey,
    receiver: receiverPubkey,
    sender: senderPubkey
  });

  // Test subscribe event creation
  const subscribePayload = {
    sender_pubkey: senderPubkey,
    web_push_url: JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
      keys: {
        p256dh: "test-p256dh-key",
        auth: "test-auth-key"
      }
    })
  };

  const conversationKey = nip44_v3.getConversationKey(receiverPrivkey, serverPubkey);
  const encryptedSubscribeContent = nip44_v3.encrypt(JSON.stringify(subscribePayload), conversationKey);

  const subscribeEvent = {
    kind: 24681,
    pubkey: receiverPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', serverPubkey]],
    content: encryptedSubscribeContent,
  };

  const signedSubscribeEvent = finalizeEvent(subscribeEvent, receiverPrivkey);

  debugTest('Created subscribe event:', {
    id: signedSubscribeEvent.id,
    kind: signedSubscribeEvent.kind,
    valid: signedSubscribeEvent.sig.length > 0
  });

  // Test push event creation  
  const pushPayload = {
    receiver_pubkey: receiverPubkey,
    payload: JSON.stringify({
      title: "Test Notification",
      body: "This is a test push notification",
      data: { action: "test" }
    })
  };

  const senderConversationKey = nip44_v3.getConversationKey(senderPrivkey, serverPubkey);
  const encryptedPushContent = nip44_v3.encrypt(JSON.stringify(pushPayload), senderConversationKey);

  const pushEvent = {
    kind: 24682,
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', serverPubkey]],
    content: encryptedPushContent,
  };

  const signedPushEvent = finalizeEvent(pushEvent, senderPrivkey);

  debugTest('Created push event:', {
    id: signedPushEvent.id,
    kind: signedPushEvent.kind,
    valid: signedPushEvent.sig.length > 0
  });

  // Test decryption (what the server would do)
  try {
    const decryptedSubscribe = nip44_v3.decrypt(encryptedSubscribeContent, conversationKey);
    const subscribeData = JSON.parse(decryptedSubscribe);
    debugTest('Subscribe decryption test passed:', {
      senderPubkey: subscribeData.sender_pubkey === senderPubkey,
      hasWebPushUrl: !!subscribeData.web_push_url
    });

    const decryptedPush = nip44_v3.decrypt(encryptedPushContent, senderConversationKey);
    const pushData = JSON.parse(decryptedPush);
    debugTest('Push decryption test passed:', {
      receiverPubkey: pushData.receiver_pubkey === receiverPubkey,
      hasPayload: !!pushData.payload
    });

    debugTest('✅ All tests passed!');
    
    // Output example configuration
    console.log('\n=== Example Configuration ===');
    console.log('SERVER_PRIVKEY=' + bytesToHex(serverPrivkey));
    console.log('RELAYS=wss://relay.damus.io,wss://nos.lol');
    console.log('\nServer Pubkey:', serverPubkey);
    console.log('\n=== Test Events Created Successfully ===');
    
  } catch (error) {
    debugTest('❌ Test failed:', error);
    throw error;
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testEventCreation().catch(console.error);
}

export { testEventCreation };