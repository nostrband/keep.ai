import { BroadcastChannel, createLeaderElection, LeaderElector } from "broadcast-channel";
import debug from "debug";

const debugLeaderWebWorker = debug("browser:LeaderWebWorker");

type WorkerType = "classic" | "module";
export type LeaderWebWorkerOptions = { name?: string; type?: WorkerType };

type MsgHandler = (ev: MessageEvent) => void;
type ErrHandler = (ev: { reason: string; error?: unknown }) => void;

export class LeaderWebWorker {
  private url: string | URL;
  private name: string;
  private type: WorkerType;

  private chan?: BroadcastChannel<any>;
  private elector?: LeaderElector;
  private worker?: Worker;

  private started = false;
  private _isLeader = false;

  private msgHandlers = new Set<MsgHandler>();
  private errHandlers = new Set<ErrHandler>();

  constructor(workerUrl: string | URL, opts?: LeaderWebWorkerOptions) {
    this.url = workerUrl;
    this.name = opts?.name ?? stableName(String(workerUrl));
    this.type = opts?.type ?? (supportsModuleDedicatedWorker() ? "module" : "classic");
  }

  /** Read-only leadership flag for callers */
  get isLeader(): boolean { return this._isLeader; }

  addEventListener(type: "message" | "error", fn: MsgHandler | ErrHandler) {
    if (type === "message") this.msgHandlers.add(fn as MsgHandler);
    else this.errHandlers.add(fn as ErrHandler);
  }
  removeEventListener(type: "message" | "error", fn: MsgHandler | ErrHandler) {
    if (type === "message") this.msgHandlers.delete(fn as MsgHandler);
    else this.errHandlers.delete(fn as ErrHandler);
  }

  postMessage(data: any) {
    if (!this.started || !this.worker || !this._isLeader) throw new Error("Worker not started or not leader");
    this.worker.postMessage(data);
  }

  async start(): Promise<void> {
    if (this.started) return;

    debugLeaderWebWorker("elector name", this.name);
    this.chan = new BroadcastChannel(`lw:${this.name}`);
    this.elector = createLeaderElection(this.chan);

    if (await this.elector.hasLeader()) {
      await this.cleanupElectionOnly();
      const err = new Error("ACTIVE_ELSEWHERE");
      (err as any).code = "ACTIVE_ELSEWHERE";
      throw err;
    }

    let becameLeader = false;
    try {
      await this.elector.awaitLeadership();
      becameLeader = this.elector.isLeader;
    } catch {}
    debugLeaderWebWorker("becameLeader", becameLeader);

    if (!becameLeader) {
      await this.cleanupElectionOnly();
      const err = new Error("ACTIVE_ELSEWHERE");
      (err as any).code = "ACTIVE_ELSEWHERE";
      throw err;
    }

    this._isLeader = true;

    // If another tab wins later, emit error and shut down.
    this.elector.onduplicate = async () => {
      this._isLeader = false;
      debugLeaderWebWorker("LEADERSHIP_LOST");
      this.emitError({ reason: "LEADERSHIP_LOST" });
      await this.terminate().catch(() => {});
    };

    const absUrl = String(new URL(String(this.url), globalThis.location?.href));
    const w = new Worker(absUrl, { type: this.type });
    w.onmessage = (ev) => this.emitMessage(ev.data);
    w.onerror = (ev) => this.emitError({ reason: "WORKER_ERROR", error: ev });

    this.worker = w;
    this.started = true;
  }

  async terminate(): Promise<void> {
    try {
      if (this.worker) { try { this.worker.terminate(); } catch {} }
      if (this.elector) { try { await this.elector.die(); } catch {} }
      if (this.chan) { try { await this.chan.close(); } catch {} }
    } finally {
      this.worker = undefined;
      this.elector = undefined;
      this.chan = undefined;
      this.started = false;
      this._isLeader = false;
    }
  }

  // internals
  private emitMessage(data: any) {
    const ev = new MessageEvent("message", { data });
    for (const fn of this.msgHandlers) fn(ev);
  }
  private emitError(e: { reason: string; error?: unknown }) {
    for (const fn of this.errHandlers) fn(e);
  }
  private async cleanupElectionOnly() {
    try { await this.elector?.die(); } catch {}
    try { await this.chan?.close(); } catch {}
    this.elector = undefined;
    this.chan = undefined;
  }
}

// helpers
export function stableName(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `lw-${h.toString(36)}`;
}
function supportsModuleDedicatedWorker(): boolean {
  try {
    const b = new Blob(["export {};"], { type: "text/javascript" });
    const u = URL.createObjectURL(b);
    const w = new Worker(u, { type: "module" as any });
    w.terminate(); URL.revokeObjectURL(u);
    return true;
  } catch { return false; }
}