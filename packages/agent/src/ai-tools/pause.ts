import { z } from "zod";
import { tool } from "ai";

const PauseInfoSchema = z.object({
  resumeAt: z.string().optional().describe("ISO timestamp when this task should be resumed"),
  asks: z.string().optional().describe("Questions for user"),
  notes: z
    .string()
    .optional()
    .describe("Task notes, omit to keep current notes"),
  plan: z.string().optional().describe("Task plan, omit to keep current plan"),
});

export type PauseInfo = z.infer<typeof PauseInfoSchema>;

export function makePauseTool(opts: {
  onPause: (info: PauseInfo) => void;
}) {
  return tool({
    execute: async (info: PauseInfo): Promise<void> => {
      opts.onPause(info);
      return Promise.resolve();
    },
    description: `Pause execution of this task to ask questions to user, and/or to wait until specific timestamp.
If 'asks' is specified, these questions will be stored in task context and asked to user until answered.
The 'notes' and 'plan' will be stored in task context for future reference. 
If 'resumeAt' is provided, the task will proceed after the specified timestamp.
`,
    inputSchema: PauseInfoSchema,
  });
}
