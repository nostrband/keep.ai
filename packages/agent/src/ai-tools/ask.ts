import { JSONSchema } from "../json-schema";
import { AITool } from "./types";

export interface AskInfo {
  asks: string;
  options?: string[];
}

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
  return {
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
`,
    inputSchema: {
      type: "object",
      properties: {
        asks: { type: "string", description: "Question for user. Keep it short and specific." },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Quick-reply options for the user. Use for yes/no or multiple-choice questions. Example: ['Yes', 'No'] or ['Archive', 'Delete', 'Skip']",
        },
      },
      required: ["asks"],
    } as JSONSchema,
  } satisfies AITool;
}
