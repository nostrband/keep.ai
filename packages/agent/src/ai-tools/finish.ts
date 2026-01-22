import { z } from "zod";
import { tool } from "ai";

// Spec 10: Removed notes and plan fields (no longer used)
const FinishInfoSchema = z.object({
  reply: z.string().optional().describe("Reply for user"),
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
    description: `Finish execution of this task and provide a 'reply'.
The reply will be sent to the client (user or caller task).
`,
    inputSchema: FinishInfoSchema,
  });
}
