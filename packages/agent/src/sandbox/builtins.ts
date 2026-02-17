/**
 * Sandbox builtins — sync functions injected directly into QuickJS global scope.
 *
 * These bypass the tool wrapper pipeline (no phase restrictions, no workflow-active check,
 * no mutation tracking) because they are pure utilities with no side effects.
 *
 * Errors become normal catchable QuickJS exceptions (no abortController.abort()).
 */
import { EvalContext } from "./sandbox";
import { atobCompatAny } from "../tools/atob";

/**
 * Format and log a message, matching the Console.log tool output format.
 */
function syncLog(ctx: EvalContext, prefix: string, args: unknown[]): void {
  // Join args with space, matching standard console.log behavior
  const raw = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");

  // Crop before escaping to ensure predictable 1000 char limit
  const cropped = raw.length > 1000 ? raw.substring(0, 1000) + "..." : raw;

  // Escape backslashes first, then single quotes (order matters)
  const escaped = cropped.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  const timestamp = new Date().toISOString();
  const formattedLine = `[${timestamp}] ${prefix}: '${escaped}'`;

  // onLog is sync (just logs.push()) — fire and forget
  ctx.onLog(formattedLine);
}

/**
 * Create builtin globals to merge into the QuickJS sandbox.
 *
 * Returns a plain object whose keys become global properties:
 * - `console.log/warn/error` — sync logging matching standard JS API
 * - `atob` — sync base64 decoding matching standard JS API
 */
export function createBuiltins(getContext: () => EvalContext) {
  return {
    console: {
      log: (...args: unknown[]) => syncLog(getContext(), "LOG", args),
      warn: (...args: unknown[]) => syncLog(getContext(), "WARN", args),
      error: (...args: unknown[]) => syncLog(getContext(), "ERROR", args),
    },
    atob: (input: unknown) => atobCompatAny(String(input)),
  };
}
