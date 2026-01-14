import { z } from "zod";
import { tool } from "ai";

const AskInfoSchema = z.object({
  asks: z.string().describe("Questions for user"),
  notes: z
    .string()
    .optional()
    .describe("Task notes, omit to keep current notes"),
  plan: z.string().optional().describe("Task plan, omit to keep current plan"),
});

export type AskInfo = z.infer<typeof AskInfoSchema>;

export function makeAskTool(opts: {
  onAsk: (info: AskInfo) => void;
}) {
  return tool({
    execute: async (info: AskInfo): Promise<void> => {
      opts.onAsk(info);
      return Promise.resolve();
    },
    description: `Pause execution of this task to ask questions to user.
The 'asks' questions will be stored in task context and asked to user until answered.
The 'notes' and 'plan', if provided, will update the values stored in task context. 
`,
    inputSchema: AskInfoSchema,
  });
}
