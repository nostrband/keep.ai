/// <reference lib="webworker" />

import { MessagePortLike } from "@app/browser";
import debug from "debug";
import { SyncWorker } from "./ui/lib/worker";
import { API_ENDPOINT } from "./const";

debug.enable("*");

// MessagePortLike implementation that forwards to globalThis
class GlobalMessagePort implements MessagePortLike {
  postMessage(message: any): void {
    globalThis.postMessage(message);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent) => void
  ): void {
    globalThis.addEventListener(type, listener as EventListener);
  }
}

async function main() {
  const worker = new SyncWorker(API_ENDPOINT + "/worker");

  // Create global message port
  const messagePort = new GlobalMessagePort();
  worker.addPort(messagePort);

  // Start processing messages etc
  worker.start();
}

console.log("[Worker] Starting...");

main()
