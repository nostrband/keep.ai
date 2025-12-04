import {
  getQuickJS,
  QuickJSContext,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten";
import { TaskType } from "../repl-agent-types";
import { DBInterface } from "packages/db/dist";

export interface EvalGlobal {
  memory: any,
  tools: any,
  tasks: any,
  docs: (tool: string) => string;
}

export type EvalResult =
  | { ok: true; result: unknown, state?: unknown }
  | { ok: false; error: string };

export interface SandboxOptions {
  timeoutMs?: number;
  memoryLimitBytes?: number;
  maxStackSizeBytes?: number;
}

export interface EvalOptions {
  state?: unknown;
  filename?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

let qjs: QuickJSWASMModule | undefined;

export async function initSandbox(
  options: SandboxOptions = {}
): Promise<Sandbox> {
  if (!qjs) qjs = await getQuickJS();
  return new Sandbox(qjs, options);
}

export interface EvalContext {
  taskThreadId: string;
  step: number;
  type: TaskType;
  taskId: string;
  taskRunId: string;
  data?: any;
  createEvent(type: string, content: any, tx?: DBInterface): Promise<void>;
}

export class Sandbox {
  #rt: QuickJSRuntime;
  #ctx: QuickJSContext;
  #defaultTimeoutMs: number;
  #running = false;
  #abortedReason?: string;
  #abortedCallback?: () => void;
  #context?: EvalContext;

  constructor(qjs: QuickJSWASMModule, options: SandboxOptions = {}) {
    this.#rt = qjs.newRuntime();

    if (options.memoryLimitBytes !== undefined) {
      this.#rt.setMemoryLimit(options.memoryLimitBytes);
    } else {
      this.#rt.setMemoryLimit(16 * 1024 * 1024);
    }

    if (options.maxStackSizeBytes !== undefined) {
      this.#rt.setMaxStackSize(options.maxStackSizeBytes);
    } else {
      this.#rt.setMaxStackSize(512 * 1024);
    }

    this.#ctx = this.#rt.newContext();
    this.#defaultTimeoutMs = options.timeoutMs ?? 300;
  }

  dispose(): void {
    this.#ctx.dispose();
    this.#rt.dispose();
    this.#abortedCallback = undefined;
  }

  get context(): EvalContext | undefined {
    return this.#context;
  }

  set context(context: EvalContext) {
    this.#context = context;;
  }

  setGlobal(bindings: EvalGlobal): void {
    this.#assertIdle();
    if (bindings === null || typeof bindings !== "object") {
      throw new TypeError("Sandbox globals must be provided as an object");
    }
    this.injectInto(this.#ctx, bindings, this.#ctx.global);
  }

  async eval(code: string, options: EvalOptions = {}): Promise<EvalResult> {
    this.#assertIdle();

    // Reset
    this.#running = true;
    this.#abortedReason = undefined;
    this.#abortedCallback = undefined;

    // Helper
    const setAbortedReason = () => {
      this.#abortedReason = signal?.reason?.toString() || "Aborted";
    };

    // Immediate signal check
    const signal = options.signal;
    if (signal?.aborted) {
      this.#running = false;
      setAbortedReason();
      return { ok: false, error: this.#abortedReason! };
    }

    const timeout = options.timeoutMs ?? this.#defaultTimeoutMs;
    const deadline =
      Number.isFinite(timeout) && timeout !== Infinity
        ? Date.now() + Math.max(0, timeout)
        : undefined;
    const interruptAfterDeadline =
      deadline !== undefined
        ? shouldInterruptAfterDeadline(deadline)
        : undefined;

    let abortListener: (() => void) | undefined;
    if (signal) {
      abortListener = () => {
        setAbortedReason();
        const cb = this.#abortedCallback;
        this.#abortedCallback = undefined;
        cb?.();
      };
      signal.addEventListener("abort", abortListener, { once: true });
    }

    this.#rt.setInterruptHandler((runtime) => {
      if (this.#abortedReason !== undefined) return true;
      return interruptAfterDeadline ? interruptAfterDeadline(runtime) : false;
    });

    const filename = options.filename ?? "code.js";
    const wrappedSource = `(async () => { ${code}\n })()`; // \n in case code ends with // comment

    try {
      // Inject state for this eval step
      if (options.state) {
        this.injectInto(this.#ctx, { state: options.state }, this.#ctx.global);
      }

      // console.log("code", wrappedSource);
      const evaluation = this.#ctx.evalCode(wrappedSource, filename, {
        type: "global",
      });
      try {
        const valueHandle = this.#ctx.unwrapResult(evaluation);
        const result = (await this.#resolveHandle(valueHandle, deadline)) as {
          result: any,
          state?: any
        };
        console.log("result", result);
        return { ok: true, result: result.result, state: result.state };
      } catch (error) {
        return { ok: false, error: this.#formatError(error) };
      } finally {
        disposeIfAlive(evaluation);
      }
    } catch (error) {
      return { ok: false, error: this.#formatError(error) };
    } finally {
      this.#rt.removeInterruptHandler();
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
      this.#running = false;
    }
  }

  async #resolveHandle(
    handle: QuickJSHandle,
    deadline?: number
  ): Promise<unknown> {
    try {
      return await this.#unwrapOrAwait(handle, deadline);
    } finally {
      handle.dispose?.();
    }
  }

  async #unwrapOrAwait(
    handle: QuickJSHandle,
    deadline?: number
  ): Promise<unknown> {
    // Helper
    const checkAbort = () => {
      if (this.#abortedReason !== undefined) {
        throw new Error(this.#abortedReason);
      }
      if (deadline !== undefined && Date.now() > deadline) {
        throw new Error("Execution timed out");
      }
    };

    // Check abort state
    checkAbort();

    const state = this.#ctx.getPromiseState(handle);
    if (state.type === "pending") {
      // Create host-level promise first
      const promise = this.#ctx.resolvePromise(handle);
      // Force a run on guest to fulfill it
      this.#flushPendingJobs();

      // Check deadline again as flush might have taken time
      checkAbort();

      // Abort promise
      const abortPromise = new Promise<never>((_, err) => {
        this.#abortedCallback = err;
        if (deadline)
          setTimeout(() => {
            this.#abortedCallback = undefined;
            err("Timeout");
          }, deadline - Date.now());
      });

      // Await on host, race with abort promise
      const resolved = await Promise.race([promise, abortPromise]);

      // Reset
      this.#abortedCallback = undefined;
      try {
        // Process result recursively
        const settledHandle = this.#ctx.unwrapResult(resolved);
        return await this.#resolveHandle(settledHandle, deadline);
      } finally {
        disposeIfAlive(resolved);
      }
    }

    if (state.type === "fulfilled" && !state.notAPromise) {
      try {
        return this.#ctx.dump(state.value);
      } finally {
        state.value.dispose();
      }
    }

    if (state.type === "rejected") {
      try {
        const rejection = this.#ctx.dump(state.error);
        const error = `${rejection.name}: '${rejection.message}' stack:\n${rejection.stack}`;
        throw new Error(error);
      } finally {
        state.error.dispose();
      }
    }

    return this.#ctx.dump(handle);
  }

  #flushPendingJobs(): void {
    while (this.#rt.alive && this.#rt.hasPendingJob()) {
      const pending = this.#rt.executePendingJobs();
      try {
        const executed = pending.unwrap();
        if (executed <= 0) {
          break;
        }
      } catch (error) {
        throw this.#normalizeError(error);
      } finally {
        disposeIfAlive(pending);
      }
    }
  }

  #formatError(error: unknown): string {
    if (this.#abortedReason !== undefined) {
      return this.#abortedReason;
    }
    return formatQuickJSError(error, this.#ctx);
  }

  #normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(this.#formatError(error));
  }

  #assertIdle(): void {
    if (this.#running) {
      throw new Error("Sandbox is already evaluating code");
    }
    this.#ensureAlive();
  }

  #ensureAlive(): void {
    if (!this.#ctx.alive || !this.#rt.alive) {
      throw new Error("Sandbox has been disposed");
    }
  }

  private injectInto(
    ctx: QuickJSContext,
    source: Record<PropertyKey, unknown> | object,
    target: QuickJSHandle
  ): void {

    const table = source as Record<PropertyKey, unknown>;
    for (const rawKey of Reflect.ownKeys(table)) {
      const value = table[rawKey];
      const key =
        typeof rawKey === "string" || typeof rawKey === "number"
          ? rawKey
          : String(rawKey);
      const handle = this.hostValueToHandle(ctx, value, key || "property");
      try {
        ctx.setProp(target, key, handle);
      } finally {
        disposeIfAlive(handle);
      }
    }
  }

  private hostValueToHandle(
    ctx: QuickJSContext,
    value: unknown,
    label: string
  ): QuickJSHandle {
    switch (typeof value) {
      case "undefined":
        return duplicateStatic(ctx.undefined);
      case "boolean":
        return duplicateStatic(value ? ctx.true : ctx.false);
      case "number":
        return ctx.newNumber(value);
      case "bigint":
        return ctx.newBigInt(value);
      case "string":
        return ctx.newString(value);
      case "function":
        return this.createFunctionHandle(
          ctx,
          value as (...args: unknown[]) => unknown,
          label
        );
      case "object": {
        if (value === null) {
          return duplicateStatic(ctx.null);
        }
        if (value instanceof Date) {
          return ctx.newString(value.toISOString());
        }
        if (value instanceof RegExp) {
          return ctx.newString(value.toString());
        }
        if (value instanceof ArrayBuffer) {
          return ctx.newArrayBuffer(value);
        }
        if (ArrayBuffer.isView(value)) {
          const view = value as ArrayBufferView;
          if (isTypedArray(view)) {
            return this.createArrayHandle(
              ctx,
              Array.from(view as Iterable<unknown>),
              label
            );
          }
          const bytes = new Uint8Array(
            view.buffer.slice(
              view.byteOffset,
              view.byteOffset + view.byteLength
            )
          );
          return this.createArrayHandle(ctx, Array.from(bytes), label);
        }
        if (Array.isArray(value)) {
          return this.createArrayHandle(ctx, value, label);
        }
        if (value instanceof Map) {
          return this.createObjectHandle(
            ctx,
            Object.fromEntries(
              value as Map<string | number | symbol, unknown>
            ) as Record<string, unknown>,
            label
          );
        }
        if (value instanceof Set) {
          return this.createArrayHandle(
            ctx,
            Array.from(value as Set<unknown>),
            label
          );
        }
        return this.createObjectHandle(
          ctx,
          value as Record<string | number | symbol, unknown>,
          label
        );
      }
      default:
        return duplicateStatic(ctx.undefined);
    }
  }

  private createArrayHandle(
    ctx: QuickJSContext,
    values: unknown[],
    label: string
  ): QuickJSHandle {
    const arrayHandle = ctx.newArray();
    values.forEach((entry, index) => {
      const elementHandle = this.hostValueToHandle(
        ctx,
        entry,
        `${label}[${index}]`
      );
      try {
        ctx.setProp(arrayHandle, index, elementHandle);
      } finally {
        elementHandle.dispose();
      }
    });
    return arrayHandle;
  }

  private createObjectHandle(
    ctx: QuickJSContext,
    obj: Record<string | number | symbol, unknown>,
    label: string
  ): QuickJSHandle {
    const objectHandle = ctx.newObject();
    for (const [key, entry] of Object.entries(obj)) {
      const propertyHandle = this.hostValueToHandle(
        ctx,
        entry,
        `${label}.${key}`
      );
      try {
        ctx.setProp(objectHandle, key, propertyHandle);
      } finally {
        propertyHandle.dispose();
      }
    }
    return objectHandle;
  }

  private createFunctionHandle(
    ctx: QuickJSContext,
    fn: (...args: unknown[]) => unknown,
    name: string
  ): QuickJSHandle {
    const functionName = name || "fn";

    return ctx.newFunction(functionName, (...argHandles) => {
      const args = argHandles.map((handle) => ctx.dump(handle));
      let result: unknown;

      try {
        result = fn(...args);
      } catch (error) {
        return { error: ctx.newError(renderHostErrorMessage(error)) };
      }

      if (isPromiseLike(result)) {
        const deferred = ctx.newPromise();
        (result as Promise<unknown>)
          .then((resolved) => {
            const resolvedHandle = this.hostValueToHandle(
              ctx,
              resolved,
              `${functionName}:resolve`
            );
            try {
              deferred.resolve(resolvedHandle);
            } finally {
              resolvedHandle.dispose();
            }
          })
          .catch((reason) => {
            const rejectionHandle = ctx.newError(
              renderHostErrorMessage(reason)
            );
            try {
              deferred.reject(rejectionHandle);
            } finally {
              rejectionHandle.dispose();
            }
          });

        // Wake the ctx up to proceed
        deferred.settled.then(() =>
          queueMicrotask(() => this.#flushPendingJobs())
        );

        return deferred.handle;
      }

      return this.hostValueToHandle(ctx, result, `${functionName}:result`);
    });
  }
}

function duplicateStatic(handle: QuickJSHandle): QuickJSHandle {
  return handle.dup() as QuickJSHandle;
}

function renderHostErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Promise<unknown>).then === "function"
  );
}

function formatQuickJSError(error: unknown, ctx?: QuickJSContext): string {
  if (isQuickJSUnwrapErrorLike(error)) {
    const cause = error.cause;
    const context = error.context;

    const dumped = dumpHandleIfPossible(cause, context ?? ctx);
    if (dumped !== undefined) {
      return dumped;
    }

    return error.message ?? "QuickJS unwrap error";
  }

  const dumped = dumpHandleIfPossible(error, ctx);
  if (dumped !== undefined) {
    return dumped;
  }

  if (error instanceof Error) {
    return error.message || error.name;
  }

  return String(error);
}

function isQuickJSHandle(value: unknown): value is QuickJSHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as QuickJSHandle).dispose === "function"
  );
}

type QuickJSUnwrapErrorLike = Error & {
  cause?: unknown;
  context?: QuickJSContext;
};

function isQuickJSUnwrapErrorLike(
  value: unknown
): value is QuickJSUnwrapErrorLike {
  return (
    value instanceof Error &&
    Object.prototype.hasOwnProperty.call(value, "cause")
  );
}

type SupportedTypedArray =
  | Uint8Array
  | Uint8ClampedArray
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array
  | BigUint64Array
  | BigInt64Array;

function isTypedArray(view: ArrayBufferView): view is SupportedTypedArray {
  return !(view instanceof DataView);
}
function dumpHandleIfPossible(
  value: unknown,
  ctx?: QuickJSContext
): string | undefined {
  if (!isQuickJSHandle(value)) {
    return undefined;
  }

  const contextCandidate = (value as unknown as { context?: QuickJSContext })
    .context;
  const owningContext =
    contextCandidate instanceof QuickJSContext ? contextCandidate : ctx;

  if (!owningContext) {
    disposeIfAlive(value);
    return "Unknown QuickJS error";
  }

  try {
    const description = owningContext.dump(value);
    return String(description);
  } finally {
    disposeIfAlive(value);
  }
}

function disposeIfAlive<T extends { dispose: () => void }>(
  value?: T | null
): void {
  if (!value || typeof value.dispose !== "function") {
    return;
  }
  if ("alive" in value && (value as { alive?: boolean }).alive === false) {
    return;
  }
  try {
    value.dispose();
  } catch (error) {
    if (
      error instanceof Error &&
      typeof error.message === "string" &&
      error.message.toLowerCase().includes("lifetime not alive")
    ) {
      return;
    }
    throw error;
  }
}
