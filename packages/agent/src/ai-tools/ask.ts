import { z } from "zod";
import { tool } from "ai";

// Re-export from @app/proto for backward compatibility
export { parseAsks, type StructuredAsk } from "@app/proto";

const AskInfoSchema = z.object({
  asks: z.string().describe("Question for user. Keep it short and specific."),
  options: z
    .array(z.string())
    .optional()
    .describe("Quick-reply options for the user. Use for yes/no or multiple-choice questions. Example: ['Yes', 'No'] or ['Archive', 'Delete', 'Skip']"),
  notes: z
    .string()
    .optional()
    .describe("Task notes, omit to keep current notes"),
  plan: z.string().optional().describe("Task plan, omit to keep current plan"),
});

export type AskInfo = z.infer<typeof AskInfoSchema>;

/**
 * Format the ask info for storage in task state.
 * If options are provided, stores as JSON; otherwise plain string.
 * Filters empty strings and removes duplicates from options.
 */
function formatAsks(asks: string, options?: string[]): string {
  if (options && options.length > 0) {
    // Filter empty/whitespace-only strings and remove duplicates
    const cleanedOptions = [...new Set(
      options
        .map(opt => opt.trim())
        .filter(opt => opt.length > 0)
    )];

    if (cleanedOptions.length > 0) {
      return JSON.stringify({ question: asks, options: cleanedOptions });
    }
  }
  return asks;
}

export function makeAskTool(opts: {
  onAsk: (info: AskInfo & { formattedAsks: string }) => void;
}) {
  return tool({
    execute: async (info: AskInfo): Promise<void> => {
      const formattedAsks = formatAsks(info.asks, info.options);
      opts.onAsk({ ...info, formattedAsks });
      return Promise.resolve();
    },
    description: `Pause execution of this task to ask a question to the user.
The question will be stored in task context and shown to the user.
When possible, provide 'options' for quick-reply buttons (e.g., yes/no or multiple choice).
Keep questions short and specific - user should be able to answer easily.

Examples with options:
- asks: "Archive or delete the processed emails?" options: ["Archive", "Delete"]
- asks: "Send summary to you only, or also to the team?" options: ["Just me", "Include team"]
- asks: "Should I process all invoice formats?" options: ["Yes, all formats", "Just PDFs"]

The 'notes' and 'plan', if provided, will update the values stored in task context.
`,
    inputSchema: AskInfoSchema,
  });
}
