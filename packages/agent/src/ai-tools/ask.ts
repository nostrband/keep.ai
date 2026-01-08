import { z } from "zod";
import { tool } from "ai";

const AskInfoSchema = z.object({
  asks: z.string().describe("Questions for user"),
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
These questions will be stored in task context and asked to user until answered.
`,
    inputSchema: AskInfoSchema,
  });
}
