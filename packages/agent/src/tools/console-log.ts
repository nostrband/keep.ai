import { JSONSchema } from "../json-schema";
import { EvalContext } from "../sandbox/sandbox";
import { defineReadOnlyTool, Tool } from "./types";

const inputSchema: JSONSchema = {
  type: "object",
  properties: {
    type: {
      enum: ["log", "warn", "error"],
      description:
        "Log level: log for general info, warn for warnings, error for errors",
    },
    line: { type: "string", description: "The message to log" },
  },
  required: ["type", "line"],
};

const outputSchema: JSONSchema = {
  type: "object",
  properties: {
    success: {
      type: "boolean",
      description: "Whether the log was recorded successfully",
    },
  },
  required: ["success"],
};

interface Input {
  type: "log" | "warn" | "error";
  line: string;
}

interface Output {
  success: boolean;
}

/**
 * Create the Console.log tool.
 * This is read-only (logging doesn't mutate user-controlled external state).
 */
export function makeConsoleLogTool(getContext: () => EvalContext): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Console",
    name: "log",
    description: `Log messages to console for debugging and monitoring.
Accepts log messages with different severity levels (log, warn, error).
Messages are timestamped and stored in run logs.`,
    inputSchema,
    outputSchema,
    execute: async (input) => {
      // Crop input BEFORE escaping to ensure predictable 1000 char limit on original input
      // and to avoid cutting escape sequences mid-way
      const croppedInput = input.line.length > 1000
        ? input.line.substring(0, 1000) + "..."
        : input.line;

      // Escape backslashes first, then single quotes
      // Order matters: backslashes must be escaped first, otherwise the backslash
      // added for quote escaping would itself get escaped
      const escapedLine = croppedInput
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");

      const croppedLine = "'" + escapedLine + "'";

      // Get current ISO timestamp
      const timestamp = new Date().toISOString();

      // Create the prefix based on type
      const prefix =
        input.type === "log" ? "LOG" : input.type === "warn" ? "WARN" : "ERROR";

      // Format the final log line
      const formattedLine = `[${timestamp}] ${prefix}: ${croppedLine}`;

      // Call the onLog callback from context
      await getContext().onLog(formattedLine);

      return { success: true };
    },
  }) as Tool<Input, Output>;
}
