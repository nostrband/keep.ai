import {
  Transport,
  Cursor,
  PeerMessage,
  serializeCursor,
  deserializeCursor,
} from "@app/sync";
import type { TransportCallbacks, TransportMessage } from "@app/sync";
import debug from "debug";

const debugTransport = debug("browser:WorkerTransport");

// Interface for message port-like objects that can be used in both SharedWorker and DedicatedWorker contexts
export interface MessagePortLike {
  postMessage(message: any): void;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
}

export class WorkerTransport implements Transport {
  private localPeerId: string = "";
  private stopped: boolean = false;
  private pendingPorts: MessagePortLike[] = [];
  private activePorts: Map<string, MessagePortLike> = new Map();
  private bufferedMessages: Array<{
    port: MessagePortLike;
    message: TransportMessage;
  }> = [];

  // Callback handlers
  private onConnectCallback?: (
    transport: Transport,
    peerId: string
  ) => Promise<void>;
  private onSyncCallback?: (
    transport: Transport,
    peerId: string,
    peerCursor: Cursor
  ) => Promise<void>;
  private onReceiveCallback?: (
    transport: Transport,
    peerId: string,
    msg: PeerMessage
  ) => Promise<void>;
  private onDisconnectCallback?: (
    transport: Transport,
    peerId: string
  ) => Promise<void>;

  constructor() {
    debugTransport("WorkerTransport created");
  }

  async start(
    config: { localPeerId: string } & TransportCallbacks
  ): Promise<void> {
    if (this.stopped) {
      throw new Error("Transport is stopped");
    }

    this.localPeerId = config.localPeerId;
    this.onConnectCallback = config.onConnect;
    this.onSyncCallback = config.onSync;
    this.onReceiveCallback = config.onReceive;
    this.onDisconnectCallback = config.onDisconnect;

    debugTransport(`Started with peer ID: ${config.localPeerId}`);

    // Start processing any pending ports
    this.processPendingPorts();

    // Process any buffered messages
    await this.processBufferedMessages();
  }

  async sync(peerId: string, localCursor: Cursor): Promise<void> {
    if (this.stopped) {
      throw new Error("Transport is stopped");
    }

    const port = this.activePorts.get(peerId);
    if (!port) {
      debugTransport(`Ignoring sync for unknown peer: ${peerId}`);
      return;
    }

    const message: TransportMessage = {
      type: "sync",
      peerId: this.localPeerId,
      cursor: serializeCursor(localCursor),
    };

    try {
      port.postMessage(message);
      debugTransport(`Sent sync message to peer: ${peerId}`, localCursor);
    } catch (error) {
      debugTransport(`Failed to send sync message to peer ${peerId}:`, error);
    }
  }

  async send(peerId: string, changes: PeerMessage): Promise<void> {
    if (this.stopped) {
      throw new Error("Transport is stopped");
    }

    const port = this.activePorts.get(peerId);
    if (!port) {
      debugTransport(`Ignoring send for unknown peer: ${peerId}`);
      return;
    }

    const message: TransportMessage = {
      type: "data",
      peerId: this.localPeerId,
      data: changes,
    };

    try {
      port.postMessage(message);
      debugTransport(`Sent data message to peer: ${peerId}`, changes);
    } catch (error) {
      debugTransport(`Failed to send data message to peer ${peerId}:`, error);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;

    // Send disconnect to all active ports
    for (const [peerId, port] of this.activePorts) {
      try {
        const message: TransportMessage = {
          type: "disconnect",
          peerId: this.localPeerId,
        };
        port.postMessage(message);
        debugTransport(`Sent disconnect message to peer: ${peerId}`);
      } catch (error) {
        debugTransport(`Failed to send disconnect to peer ${peerId}:`, error);
      }
    }

    // Clear all ports and buffered messages
    this.activePorts.clear();
    this.pendingPorts.length = 0;
    this.bufferedMessages.length = 0;

    debugTransport("Transport stopped");
  }

  // Method to add message ports
  addMessagePort(port: MessagePortLike): void {
    if (this.stopped) {
      debugTransport("Ignoring new port - transport is stopped");
      return;
    }

    // Set up message handler for this port
    port.addEventListener("message", (event) => {
      this.handlePortMessage(port, event.data);
    });

    // Add to pending list
    this.pendingPorts.push(port);
    debugTransport("Added new message port to pending list");

    // If we're already started, process immediately
    if (this.localPeerId) {
      this.processPendingPorts();
    }
  }

  private processPendingPorts(): void {
    // Send connect message to all pending ports
    for (const port of this.pendingPorts) {
      try {
        const message: TransportMessage = {
          type: "connect",
          peerId: this.localPeerId,
        };
        port.postMessage(message);
        debugTransport("Sent connect message to pending port");
      } catch (error) {
        debugTransport(
          "Failed to send connect message to pending port:",
          error
        );
      }
    }
    // Keep ports in pending until we get their peer IDs
  }

  private async processBufferedMessages(): Promise<void> {
    if (this.bufferedMessages.length === 0) {
      return;
    }

    debugTransport(
      `Processing ${this.bufferedMessages.length} buffered messages`
    );

    // Process all buffered messages
    const messagesToProcess = [...this.bufferedMessages];
    this.bufferedMessages.length = 0; // Clear the buffer

    for (const { port, message } of messagesToProcess) {
      try {
        await this.handlePortMessage(port, message);
      } catch (error) {
        debugTransport(`Error processing buffered message:`, error);
      }
    }
  }

  private async handlePortMessage(
    port: MessagePortLike,
    message: TransportMessage
  ): Promise<void> {
    if (this.stopped) {
      return;
    }

    debugTransport(`Received message from port:`, message);

    // If we haven't started yet (no localPeerId), buffer the message
    if (!this.localPeerId) {
      debugTransport(`Buffering message - transport not started yet:`, message);
      this.bufferedMessages.push({ port, message });
      return;
    }

    try {
      switch (message.type) {
        case "connect":
          await this.handleConnect(port, message.peerId);
          break;
        case "disconnect":
          await this.handleDisconnect(message.peerId);
          break;
        case "sync":
          await this.handleSync(message.peerId, message);
          break;
        case "data":
          if (message.data) {
            await this.handleData(message.peerId, message.data);
          }
          break;
        // Other worker-tab messages that might be used
        // by clients are left unhandled
      }
    } catch (error) {
      debugTransport(
        `Error handling message from peer ${message.peerId}:`,
        error
      );

      // Send disconnect and reconnect after pause
      await this.handleCallbackError(message.peerId);
    }
  }

  private async handleConnect(
    port: MessagePortLike,
    peerId: string
  ): Promise<void> {
    // Move port from pending to active
    const pendingIndex = this.pendingPorts.indexOf(port);
    if (pendingIndex >= 0) {
      this.pendingPorts.splice(pendingIndex, 1);
    }

    this.activePorts.set(peerId, port);
    debugTransport(`Peer connected: ${peerId}`);

    if (!this.onConnectCallback) throw new Error("Peer message before start()");
    await this.onConnectCallback(this, peerId);
  }

  private async handleDisconnect(peerId: string): Promise<void> {
    this.activePorts.delete(peerId);
    debugTransport(`Peer disconnected: ${peerId}`);

    if (!this.onDisconnectCallback)
      throw new Error("Peer message before start()");
    await this.onDisconnectCallback(this, peerId);
  }

  private async handleSync(
    peerId: string,
    message: TransportMessage
  ): Promise<void> {
    debugTransport(`Received sync from peer: ${peerId}`, message.cursor);

    if (!this.onSyncCallback) throw new Error("Peer message before start()");
    if (!message.cursor) throw new Error("Sync message without cursor");
    const peerCursor = deserializeCursor(message.cursor);
    await this.onSyncCallback(this, peerId, peerCursor);
  }

  private async handleData(peerId: string, data: PeerMessage): Promise<void> {
    debugTransport(`Received data from peer: ${peerId}`, data);

    if (!this.onReceiveCallback) throw new Error("Peer message before start()");
    await this.onReceiveCallback(this, peerId, data);
  }

  private async handleCallbackError(peerId: string): Promise<void> {
    debugTransport(`Handling callback error for peer: ${peerId}`);

    const port = this.activePorts.get(peerId);
    if (port) {
      try {
        // Send disconnect
        const disconnectMessage: TransportMessage = {
          type: "disconnect",
          peerId: this.localPeerId,
        };
        port.postMessage(disconnectMessage);

        // Remove from active ports
        this.activePorts.delete(peerId);

        // Wait a bit then send connect to retry
        setTimeout(() => {
          if (!this.stopped && port) {
            try {
              const connectMessage: TransportMessage = {
                type: "connect",
                peerId: this.localPeerId,
              };
              port.postMessage(connectMessage);
              debugTransport(`Sent reconnect message to peer: ${peerId}`);
            } catch (error) {
              debugTransport(
                `Failed to send reconnect to peer ${peerId}:`,
                error
              );
            }
          }
        }, 1000); // 1 second pause
      } catch (error) {
        debugTransport(
          `Failed to handle callback error for peer ${peerId}:`,
          error
        );
      }
    }
  }
}
