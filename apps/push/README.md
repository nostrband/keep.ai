# Web Push Notification Server

A TypeScript-based Nostr web push notification server that enables push notifications in serverless mode for Keep.AI web applications.

## Overview

This server listens for Nostr events on specified relays and handles two types of events:

- **Kind 24681 (Subscribe)**: Users register for push notifications by providing a web push subscription URL
- **Kind 24682 (Push)**: Senders trigger push notifications to registered receivers

## Architecture

The server uses:
- **Nostr Protocol**: For decentralized event communication
- **NIP-44**: For end-to-end encryption of event content
- **SQLite**: For storing push subscription mappings
- **Web Push Protocol**: For sending actual push notifications to browsers

## Setup

### 1. Environment Configuration

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server's nostr private key in hex format
SERVER_PRIVKEY=your_private_key_hex_here

# Comma-separated list of Nostr relays
RELAYS=wss://relay1.getkeep.ai,wss://relay2.getkeep.ai

# VAPID configuration for web push
EMAIL=mailto:your-email@example.com
PUSH_PUBKEY=your_vapid_public_key_here
PUSH_SECKEY=your_vapid_private_key_here
```

### 2. Generate VAPID Keys

Generate VAPID keys for web push authentication:

```bash
npx web-push generate-vapid-keys
```

This will output the keys you need to add to your `.env` file.

### 3. Install Dependencies

```bash
npm install
```

### 4. Build the Server

```bash
npm run build
```

### 5. Start the Server

```bash
npm start
```

Or for development:

```bash
npm run dev
```

## Event Specifications

### Subscribe Event (Kind 24681)

Users send this event to register for push notifications:

```javascript
{
  id: "event_id",
  kind: 24681,
  pubkey: "receiver_pubkey", // User who wants to receive notifications
  created_at: timestamp,
  tags: [
    ['p', server_pubkey_hex], // Tags the push server
  ],
  content: nip44_encrypt(receiver_privkey, server_pubkey, JSON.stringify({
    sender_pubkey: "pubkey_that_can_send_to_receiver", // Who can send notifications
    web_push_url: "{"endpoint":"https://...","keys":{...}}" // Browser push subscription
  }))
}
```

### Push Event (Kind 24682)

Senders use this event to trigger a push notification:

```javascript
{
  id: "event_id", 
  kind: 24682,
  pubkey: "sender_pubkey", // Who is sending the notification
  created_at: timestamp,
  tags: [
    ['p', server_pubkey_hex], // Tags the push server
  ],
  content: nip44_encrypt(sender_privkey, server_pubkey, JSON.stringify({
    receiver_pubkey: "pubkey_that_should_be_notified", // Target user
    payload: "notification_payload_string" // What to send to browser
  }))
}
```

## Database Schema

The server maintains a SQLite database with the following table:

```sql
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receiver_pubkey TEXT NOT NULL,     -- User who receives notifications
  sender_pubkey TEXT NOT NULL,       -- User who can send notifications  
  web_push_url TEXT NOT NULL,        -- Browser push subscription JSON
  created_at INTEGER NOT NULL,       -- Unix timestamp
  UNIQUE(receiver_pubkey, sender_pubkey)
);
```

## Error Handling

The server handles various error conditions:

### Rate Limiting (429 Status Code)

When a push endpoint returns a 429 (Too Many Requests) status code, the server:

1. **Extracts the domain** from the push endpoint URL
2. **Parks the domain** for the duration specified in the `Retry-After` header
3. **Queues subsequent pushes** to that domain until the rate limit expires
4. **Retries all queued pushes** automatically when the rate limit period ends

The `Retry-After` header can be:
- A number of seconds: `Retry-After: 120`
- A date string: `Retry-After: Wed, 21 Oct 2015 07:28:00 GMT`

If no `Retry-After` header is provided, the server defaults to a 5-minute delay.

**Note**: Rate limit state is kept in memory only. If the server restarts, all rate limiting information and queued pushes are lost (this is by design for simplicity).

### Invalid/Expired Web Push Subscriptions

When web push delivery fails with certain HTTP status codes (410, 413, 400, 404), the server automatically removes the invalid subscription from the database.

### Decryption Failures

Events that cannot be decrypted (wrong recipient, malformed content) are logged and ignored.

### Missing Subscriptions

Push events for unknown sender/receiver pairs are logged and ignored.

## Security Features

- **End-to-End Encryption**: All event content is encrypted with NIP-44
- **Public Key Verification**: Events must properly tag the server's public key
- **Content Validation**: Decrypted content is validated for required fields
- **Database Integrity**: Unique constraints prevent duplicate subscriptions

## Development

### Helper Scripts

Generate VAPID keys:
```bash
npx web-push generate-vapid-keys
```

Test event creation and encryption:
```bash
npm run test-events
```

### Type Checking

```bash
npm run type-check
```

### Development Mode

```bash
npm run dev
```

## Integration

### Client-Side Integration

1. **Generate Web Push Subscription**: Use browser's Push API to create a subscription
2. **Send Subscribe Event**: Encrypt and send kind 24681 event to register for notifications
3. **Handle Push Events**: Listen for incoming push notifications in service worker

### Sender Integration

1. **Send Push Event**: Encrypt and send kind 24682 event to trigger notification
2. **Handle Responses**: Monitor for delivery confirmations (optional)

## Dependencies

- `nostr-tools`: Nostr protocol implementation
- `web-push`: Web Push Protocol implementation
- `@app/sync`: NIP-44 encryption utilities
- `@app/node`: SQLite database interface
- `@app/db`: Database abstraction layer

## Monitoring

The server uses the `debug` library for logging. Set debug levels:

```bash
DEBUG=push:* npm start
```

Available debug namespaces:
- `push:start`: Server startup and shutdown
- `push:server`: Event processing and web push sending  
- `push:db`: Database operations

## Production Deployment

### Security Considerations

- Keep `SERVER_PRIVKEY` secure and never expose it
- Use HTTPS for all relay connections
- Monitor server logs for failed deliveries
- Regularly backup the SQLite database
- Consider rate limiting for abuse prevention

### Performance

- The server handles events asynchronously
- Database operations use transactions for consistency
- Failed web push deliveries are logged but don't block processing
- Invalid subscriptions are automatically cleaned up
- Rate limiting is handled per-domain to prevent cascade failures
- Queued pushes are processed automatically when rate limits expire

### Health Checks

The server logs successful startup and relay connections. Monitor logs for:
- Successful event processing
- Database connection health  
- Web push delivery success rates
- Relay connection status

## Troubleshooting

### Common Issues

1. **Events not received**: Check relay connectivity and server pubkey configuration
2. **Decryption failures**: Verify NIP-44 encryption keys and implementation
3. **Push delivery failures**: Check web push subscription validity and endpoint availability
4. **Database errors**: Verify SQLite file permissions and disk space