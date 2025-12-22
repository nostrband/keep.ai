import { z } from "zod";
import { tool } from "ai";

const FinishInfoSchema = z.object({
  reply: z.string().optional().describe("Reply for user"),
  notes: z
    .string()
    .optional()
    .describe("Task notes, omit to keep current notes"),
  plan: z.string().optional().describe("Task plan, omit to keep current plan"),
});

export type FinishInfo = z.infer<typeof FinishInfoSchema>;

export function makeFinishTool(opts: {
  onFinish: (info: FinishInfo) => void;
}) {
  return tool({
    execute: async (info: FinishInfo): Promise<void> => {
      opts.onFinish(info);
      return Promise.resolve();
    },
    description: `Finish execution of this task and provide task 'notes', 'plan' and 'reply'.
'Reply' will be sent to passed to client (user or caller task), 'notes' and 'plan' will
be stored in task context for future reference. 
`,
    inputSchema: FinishInfoSchema,
  });
}
