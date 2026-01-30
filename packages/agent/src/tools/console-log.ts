import { z } from "zod";
import { tool } from "ai";
import { EvalContext } from "../sandbox/sandbox";

export function makeConsoleLogTool(getContext: () => EvalContext) {
  return tool({
    description: `Log messages to console for debugging and monitoring.
Accepts log messages with different severity levels (log, warn, error).
Messages are timestamped and stored in run logs.`,
    inputSchema: z.object({
      type: z
        .enum(["log", "warn", "error"])
        .describe(
          "Log level: log for general info, warn for warnings, error for errors"
        ),
      line: z.string().describe("The message to log"),
    }),
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
  });
}
