import { hexToBytes } from "nostr-tools/utils";
import { EventEmitter } from "tseep/lib/ee-safe";

interface TabMessagePortLike {
  postMessage(msg: any): void;
  addEventListener(type: "message", handler: (m: MessageEvent) => void): void;
}

export class WorkerEventRouter extends EventEmitter<{
  connect(connStr: string, port: TabMessagePortLike): Promise<void>;
  local_key(key: Uint8Array): Promise<void>;
}> {
  private started = false;
  private buffer: [MessageEvent, TabMessagePortLike][] = [];
  private ports: TabMessagePortLike[] = [];

  constructor() {
    super();
  }

  addPort(port: TabMessagePortLike) {
    this.ports.push(port);
    port.addEventListener("message", (m) =>
      this.onMessage(m, port)
    );
  }

  broadcast(msg: any) {
    for (const p of this.ports) {
      // ChatGPT says postMessage might throw in some
      // browsers if port is inactive
      try {
        p.postMessage(msg)
      } catch {}
    }
  }

  start() {
    this.started = true;
    for (const [msg, port] of this.buffer) {
      this.handleMessage(msg, port);
    }
    this.buffer.length = 0;
  }

  private async handleMessage(msg: MessageEvent, port: TabMessagePortLike) {
    const { type, data } = msg.data;

    if (type === "connect_device") {
      this.emit("connect", data.connectionString, port);
    } else if (type === "local_key") {
      this.emit("local_key", hexToBytes(data.key));
    } else if (type === "ping") {
      // Immediately respond with pong
      port.postMessage({ type: "pong" });
    }
  }

  private onMessage(msg: MessageEvent, port: TabMessagePortLike) {
    if (this.started) this.handleMessage(msg, port);
    else this.buffer.push([msg, port]);
  }
}
