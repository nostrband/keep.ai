import { CRSqliteWorkerClientBase } from "./CRSqliteWorkerClientBase";
import { BroadcastMessage, WorkerMessage, WorkerResponse } from "./messages";
import { DBInterface } from "@app/db";
import debug from "debug";

const debugWorkerClientHTTP = debug("worker:CRSqliteWorkerClientHTTP");

// Type for fetch function to support both browser and Node.js
type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Auto-detect environment and provide appropriate fetch
function getDefaultFetch(): FetchFunction {
  // Check if we're in a browser environment
  if (typeof window !== 'undefined' && window.fetch) {
    return window.fetch.bind(window);
  }
  
  // Check if we're in Node.js with global fetch (Node 18+)
  if (typeof globalThis !== 'undefined' && globalThis.fetch) {
    return globalThis.fetch.bind(globalThis);
  }
  
  // Check if we're in Node.js with global fetch (alternative check)
  if (typeof globalThis !== 'undefined' && (globalThis as any).global?.fetch) {
    return (globalThis as any).global.fetch;
  }
  
  throw new Error('No fetch implementation found. Please provide a fetch function in the constructor.');
}

export class CRSqliteWorkerClientHTTP extends CRSqliteWorkerClientBase {
  private endpoint: string;
  private fetchFn: FetchFunction;
  private eventSource: EventSource | null = null;
  private isConnected = false;

  constructor(
    db: DBInterface,
    endpoint: string,
    fetchFn?: FetchFunction,
    onTablesChanged?: (tables: string[]) => void
  ) {
    super(db, (msg) => this.broadcastMessage(msg), onTablesChanged);
    this.endpoint = endpoint.replace(/\/$/, ''); // Remove trailing slash
    this.fetchFn = fetchFn || getDefaultFetch();
  }

  async start(): Promise<void> {
    await super.start();
    await this.connectSSE();
  }

  stop(): void {
    this.disconnectSSE();
    super.stop();
  }

  protected postMessage(message: WorkerMessage): void {
    const endpoint = message.type === 'sync' ? '/sync' : '/exec';
    
    this.fetchFn(`${this.endpoint}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data: WorkerResponse = await response.json();
      this.processWorkerMessage(data);
    })
    .catch((error) => {
      debugWorkerClientHTTP(`Error in postMessage to ${endpoint}:`, error);
      this.processWorkerMessage({
        type: 'error',
        error: error.message,
        requestId: message.requestId,
      });
    });
  }

  private async broadcastMessage(message: BroadcastMessage) {
    this.fetchFn(`${this.endpoint}/changes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    })
    .catch((error) => {
      debugWorkerClientHTTP('Error in broadcastMessage:', error);
      if (this.onError) {
        this.onError(error.message);
      }
    });
  }

  private async connectSSE(): Promise<void> {
    try {
      // Check if EventSource is available (browser environment)
      if (typeof EventSource === 'undefined') {
        debugWorkerClientHTTP('EventSource not available, SSE disabled');
        return;
      }

      this.eventSource = new EventSource(`${this.endpoint}/broadcast`);
      
      this.eventSource.onopen = () => {
        debugWorkerClientHTTP('SSE connection opened');
        this.isConnected = true;
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle connection confirmation
          if (data.type === 'connected') {
            debugWorkerClientHTTP('SSE connected with client ID:', data.data?.clientId);
            return;
          }
          
          // Handle broadcast messages
          if (data.type === 'changes') {
            this.processChanges(data as BroadcastMessage);
          }
        } catch (error) {
          debugWorkerClientHTTP('Error parsing SSE message:', error);
        }
      };

      this.eventSource.onerror = (error) => {
        debugWorkerClientHTTP('SSE error:', error);
        this.isConnected = false;
        
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (this.isStarted && !this.isConnected) {
            debugWorkerClientHTTP('Attempting to reconnect SSE...');
            this.connectSSE();
          }
        }, 5000);
      };

    } catch (error) {
      debugWorkerClientHTTP('Error setting up SSE:', error);
    }
  }

  private disconnectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      debugWorkerClientHTTP('SSE connection closed');
    }
  }

  isSSEConnected(): boolean {
    return this.isConnected;
  }

  getEndpoint(): string {
    return this.endpoint;
  }
}