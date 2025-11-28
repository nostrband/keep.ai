import dotenv from 'dotenv';
import { PushServer } from './server.js';
import debug from 'debug';

const debugStart = debug('push:start');

async function main() {
  // Load environment variables
  dotenv.config();

  const serverPrivkey = process.env.SERVER_PRIVKEY;
  const relaysEnv = process.env.RELAYS;
  const email = process.env.EMAIL;
  const pushPubkey = process.env.PUSH_PUBKEY;
  const pushSeckey = process.env.PUSH_SECKEY;

  if (!serverPrivkey) {
    console.error('ERROR: SERVER_PRIVKEY environment variable is required');
    process.exit(1);
  }

  if (!relaysEnv) {
    console.error('ERROR: RELAYS environment variable is required');
    process.exit(1);
  }

  if (!email) {
    console.error('ERROR: EMAIL environment variable is required for VAPID');
    process.exit(1);
  }

  if (!pushPubkey) {
    console.error('ERROR: PUSH_PUBKEY environment variable is required for VAPID');
    process.exit(1);
  }

  if (!pushSeckey) {
    console.error('ERROR: PUSH_SECKEY environment variable is required for VAPID');
    process.exit(1);
  }

  // Parse relays from comma-separated string
  const relays = relaysEnv.split(',').map(r => r.trim()).filter(r => r.length > 0);
  
  if (relays.length === 0) {
    console.error('ERROR: At least one relay must be specified in RELAYS');
    process.exit(1);
  }

  debugStart('Starting push server with configuration:', {
    relays,
    privkeyProvided: !!serverPrivkey,
    vapidConfigured: !!(email && pushPubkey && pushSeckey)
  });

  const server = new PushServer(serverPrivkey, relays, email, pushPubkey, pushSeckey);
  
  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    debugStart(`Received ${signal}, shutting down gracefully...`);
    try {
      await server.stop();
      debugStart('Server stopped successfully');
      process.exit(0);
    } catch (error) {
      debugStart('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await server.start();
    console.log('✅ Push notification server started successfully');
    console.log('📡 Listening for events on relays:', relays);
  } catch (error) {
    console.error('Failed to start push server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});