import { createDBBrowser, WorkerTransport } from '@app/browser';
import { MessagePortLike } from '../../../packages/browser/src/WorkerTransport';
import { Peer } from '@app/sync';
import debug from 'debug';

const debugWorker = debug('test:worker');

// MessagePortLike implementation that forwards to globalThis
class GlobalMessagePort implements MessagePortLike {
  started = false;

  async start(): Promise<void> {
    this.started = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  postMessage(message: any): void {
    globalThis.postMessage(message);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    globalThis.addEventListener(type, listener as EventListener);
  }
}

async function setupTestTables(db: any) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS test_data (
      id TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      timestamp INTEGER DEFAULT (strftime('%s', 'now')),
      source TEXT NOT NULL DEFAULT 'worker'
    )
  `);

  await db.exec("SELECT crsql_as_crr('test_data')");
  console.log('Test tables created and registered with CRSqlite');
}

async function main() {
  try {
    console.log('Starting test worker...');
    debug.enable("*");

    // First thing in sync section - create transport
    // and make sure onmessage handler is attached

    // Create global message port
    const messagePort = new GlobalMessagePort();

    // Create transport
    const transport = new WorkerTransport();
    transport.addMessagePort(messagePort);

    // Can start the port now, messages will be buffered
    // until transport is started
    await messagePort.start();

    // Create in-memory database
    const db = await createDBBrowser(':memory:');
    console.log('Database created');

    // Set up test tables
    await setupTestTables(db);

    // Create peer
    const peer = new Peer(db, [transport]);
    
    // Start peer
    await peer.start();

    // Start transport after peer has configured it
    await transport.start(peer.getConfig());

    console.log('Worker started with ID:', peer.id);

    // Insert initial data
    await db.exec(
      "INSERT INTO test_data (id, value, source) VALUES (?, ?, ?)",
      ['worker-initial', 'Initial data from worker', 'worker']
    );

    // Check for changes and broadcast
    await peer.checkLocalChanges();

    // Set up periodic data writing (every second)
    let counter = 0;
    const interval = setInterval(async () => {
      try {
        counter++;
        const id = `worker-${Date.now()}-${counter}`;
        const value = `Worker data ${counter} at ${new Date().toISOString()}`;
        
        await db.exec(
          "INSERT INTO test_data (id, value, source) VALUES (?, ?, ?)",
          [id, value, 'worker']
        );

        console.log(`Inserted data: ${id} = ${value}`);

        // Trigger sync
        await peer.checkLocalChanges();
      } catch (error) {
        console.log('Error inserting periodic data:', error);
      }
    }, 1000);

    // Listen for peer events
    peer.on('connect', (peerId) => {
      console.log('Peer connected:', peerId);
    });

    peer.on('change', (tables) => {
      console.log('Changes received for tables:', tables);
    });

    peer.on('eose', (peerId) => {
      console.log('End of stored events from peer:', peerId);
    });

    // Cleanup on worker termination
    globalThis.addEventListener('beforeunload', () => {
      clearInterval(interval);
      peer.stop();
      db.close();
    });

    console.log('Worker setup complete, periodic data writing started');

  } catch (error) {
    console.log('Error in worker setup:', error);
    throw error;
  }
}

// Start the worker
main().catch(error => {
  console.log('Fatal error in worker:', error);
});