import debug from "debug";
import { LeaderWebWorker, stableName } from "./LeaderWebWorker";
import { MessagePortLike } from "./WorkerTransport";

const debugBrowserStart = debug("browser:start");

// Interface for message port-like objects that can be used in both SharedWorker and DedicatedWorker contexts
export interface WorkerPort {
  postMessage(message: any): void;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  start(): Promise<void>;
}

export async function startWorker(opts: {
  sharedWorkerUrl?: string;
  dedicatedWorkerUrl?: string;
}): Promise<WorkerPort> {
  if (opts.sharedWorkerUrl && supportsNativeSharedWorkerModule()) {
    // Initialize shared worker
    const worker = new SharedWorker(opts.sharedWorkerUrl, {
      type: "module",
      name: stableName(String(opts.sharedWorkerUrl)),
    });

    return new MessagePortAdapter(worker.port);
  } else if (opts.dedicatedWorkerUrl) {
    // Initialize shared worker
    const worker = new LeaderWebWorker(opts.dedicatedWorkerUrl, {
      type: "module",
    });

    worker.addEventListener(
      "error",
      ({ reason, error }: { reason: string; error?: unknown }) => {
        debugBrowserStart("Failed to start worker:", reason, error);
      }
    );

    return worker;
  } else {
    throw new Error("Supported worker mode not available");
  }
}

class MessagePortAdapter implements WorkerPort {
  private started = false;

  constructor(private readonly port: MessagePort) {}

  postMessage(message: any): void {
    this.port.postMessage(message);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent) => void
  ): void {
    // MessagePort's addEventListener expects EventListener; cast is fine here.
    this.port.addEventListener(type as any, listener as EventListener);
  }

  async start(): Promise<void> {
    if (!this.started) {
      this.port.start();
      this.started = true;
    }
  }
}

function supportsNativeSharedWorkerModule(): boolean {
  try {
    const blob = new Blob(["export {};"], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    // @ts-ignore
    const w = new SharedWorker(url, { type: "module" });
    w.port.close();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

