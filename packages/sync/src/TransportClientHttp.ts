import { Transport, TransportCallbacks } from "./Transport";
import {
  Cursor,
  PeerMessage,
  TransportMessage,
  serializeCursor,
  deserializeCursor,
} from "./messages";
import debug from "debug";

const debugTransport = debug("worker:TransportClientHttp");

// Type for fetch function to support both browser and Node.js
type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

// Auto-detect environment and provide appropriate fetch
function getDefaultFetch(): FetchFunction {
  // Check if we're in a browser environment
  if (typeof window !== "undefined" && window.fetch) {
    return window.fetch.bind(window);
  }

  // Check if we're in Node.js with global fetch (Node 18+)
  if (typeof globalThis !== "undefined" && globalThis.fetch) {
    return globalThis.fetch.bind(globalThis);
  }

  // Check if we're in Node.js with global fetch (alternative check)
  if (typeof globalThis !== "undefined" && (globalThis as any).global?.fetch) {
    return (globalThis as any).global.fetch;
  }

  throw new Error(
    "No fetch implementation found. Please provide a fetch function in the constructor."
  );
}

export class TransportClientHttp implements Transport {
  private endpoint: string;
  private fetchFn: FetchFunction;
  private eventSource: EventSource | null = null;
  private callbacks?: TransportCallbacks;
  private localPeerId?: string;
  private remotePeerId?: string;
  private isConnected = false;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private baseReconnectDelay = 1000; // 1 second

  constructor(endpoint: string, fetchFn?: FetchFunction) {
    this.endpoint = endpoint.replace(/\/$/, ""); // Remove trailing slash
    this.fetchFn = fetchFn || getDefaultFetch();
  }

  async start(
    config: { localPeerId: string } & TransportCallbacks
  ): Promise<void> {
    this.localPeerId = config.localPeerId;
    this.callbacks = {
      onConnect: config.onConnect,
      onSync: config.onSync,
      onReceive: config.onReceive,
      onDisconnect: config.onDisconnect,
    };

    debugTransport(
      `Starting transport with local peer ID: ${this.localPeerId}`
    );
    await this.connectSSE();
  }

  async sync(peerId: string, localCursor: Cursor): Promise<void> {
    if (!this.localPeerId) {
      debugTransport("Cannot sync: transport not started");
      return;
    }
    if (peerId !== this.remotePeerId) {
      debugTransport(
        `Cannot sync: unknown peer '${peerId} expected '${this.remotePeerId}''`
      );
      return;
    }

    try {
      const message: TransportMessage = {
        type: "sync",
        peerId: this.localPeerId,
        cursor: serializeCursor(localCursor),
      };

      const response = await this.fetchFn(`${this.endpoint}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      debugTransport(`Sent sync to server for peer ${peerId}`);
    } catch (error) {
      debugTransport(`Error sending sync for peer ${peerId}:`, error);
      // Don't throw - transport failures should be handled gracefully
    }
  }

  async send(peerId: string, message: PeerMessage): Promise<void> {
    if (!this.localPeerId) {
      debugTransport("Cannot send: transport not started");
      return;
    }
    if (peerId !== this.remotePeerId) {
      debugTransport(
        `Cannot sync: unknown peer '${peerId} expected '${this.remotePeerId}''`
      );
      return;
    }

    try {
      const transportMessage: TransportMessage = {
        type: "data",
        peerId: this.localPeerId,
        data: message,
      };

      const response = await this.fetchFn(`${this.endpoint}/data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(transportMessage),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      debugTransport(
        `Sent ${message.type} to server for peer ${peerId} with ${message.data.length} changes`
      );
    } catch (error) {
      debugTransport(`Error sending to peer ${peerId}:`, error);
      // Don't throw - transport failures should be handled gracefully
    }
  }

  stop(): void {
    this.disconnectSSE();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    this.callbacks = undefined;
    this.localPeerId = undefined;
    this.remotePeerId = undefined;
    this.reconnectAttempts = 0;
    debugTransport("Transport stopped");
  }

  private async connectSSE(): Promise<void> {
    if (!this.localPeerId || !this.callbacks) {
      throw new Error("Transport not properly initialized");
    }

    try {
      // Check if EventSource is available
      if (typeof EventSource === "undefined") {
        // FIXME implement for nodejs
        throw new Error("EventSource not available");
      }

      debugTransport("Connecting to SSE stream...");
      // Now use GET with peerId as query parameter
      this.eventSource = new EventSource(
        `${this.endpoint}/stream?peerId=${encodeURIComponent(this.localPeerId)}`
      );

      this.eventSource.onopen = async () => {
        debugTransport("SSE connection opened");
        // No need to send separate connect message - server handles it automatically
      };

      let queue = Promise.resolve();
      this.eventSource.onmessage = (event) => {
        // Ensure handling is single-threaded
        queue = queue
          .then(async () => {
            try {
              const message: TransportMessage = JSON.parse(event.data);
              await this.handleSSEMessage(message);
            } catch (error) {
              debugTransport("Error parsing SSE message:", error);
              this.handleConnectionError();
              throw error;
            }
          })
          .catch(); // stop the queue processing on error
      };

      this.eventSource.onerror = (error) => {
        debugTransport("SSE error:", error);
        this.handleConnectionError();
      };
    } catch (error) {
      debugTransport("Error setting up SSE:", error);
      this.handleConnectionError();
    }
  }

  private async handleSSEMessage(message: TransportMessage): Promise<void> {
    if (!this.callbacks) {
      debugTransport("Received message but no callbacks available");
      return;
    }

    try {
      switch (message.type) {
        case "connect":
          debugTransport(`Received connect from peer: ${message.peerId}`);
          this.remotePeerId = message.peerId;
          this.isConnected = true;
          this.reconnectAttempts = 0;
          await this.callbacks.onConnect(this, message.peerId);
          break;

        case "sync":
          if (!message.cursor) {
            debugTransport("Received sync message without cursor");
            return;
          }
          debugTransport(`Received sync from peer: ${message.peerId}`);
          const cursor = deserializeCursor(message.cursor);
          await this.callbacks.onSync(this, message.peerId, cursor);
          break;

        case "data":
          if (!message.data) {
            debugTransport("Received data message without data");
            return;
          }
          debugTransport(
            `Received ${message.data.type} from peer: ${message.peerId} with ${message.data.data.length} changes`
          );
          await this.callbacks.onReceive(this, message.peerId, message.data);
          break;

        case "ping":
          debugTransport(`Received ping from peer: ${message.peerId}`);
          // Just log the ping - no action needed, it keeps the connection alive
          break;

        case "error":
          debugTransport(
            `Received error from peer: ${message.peerId} '${message.error}'`
          );
          // Just log the ping - no action needed, it keeps the connection alive
          break;

        default:
          debugTransport(`Unknown message type: ${(message as any).type}`);
      }
    } catch (error) {
      debugTransport(`Error handling SSE message:`, error);
      // If callback throws, we should reconnect after pause
      this.handleConnectionError();
    }
  }

  private handleConnectionError(): void {
    this.isConnected = false;
    this.remotePeerId = undefined;

    // Call onDisconnect for all connected peers if we have callbacks
    if (this.callbacks && this.localPeerId) {
      // We don't track individual peer connections in the client,
      // so we'll call onDisconnect with a generic server peer ID
      this.callbacks.onDisconnect(this, "server").catch((error) => {
        debugTransport("Error in onDisconnect callback:", error);
      });
    }

    this.disconnectSSE();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    debugTransport(
      `Scheduling reconnect in ${delay}ms (attempt ${
        this.reconnectAttempts + 1
      })`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined;
      this.reconnectAttempts++;

      if (this.localPeerId && this.callbacks) {
        debugTransport("Attempting to reconnect...");
        this.connectSSE().catch((error) => {
          debugTransport("Reconnect failed:", error);
          this.handleConnectionError();
        });
      }
    }, delay);
  }

  private disconnectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      debugTransport("SSE connection closed");
    }
    this.remotePeerId = undefined;
  }

  // Utility methods for debugging/monitoring
  isSSEConnected(): boolean {
    return this.isConnected;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  getRemotePeerId(): string | undefined {
    return this.remotePeerId;
  }
}
