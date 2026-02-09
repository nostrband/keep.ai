import { JSONSchema } from "../json-schema";
import { AITool } from "./types";

// Spec 10: Removed notes and plan fields (no longer used)
export interface FinishInfo {
  reply?: string;
}

export function makeFinishTool(opts: {
  onFinish: (info: FinishInfo) => void;
}) {
  return {
    execute: async (info: FinishInfo): Promise<void> => {
      opts.onFinish(info);
      return Promise.resolve();
    },
    description: `Finish execution of this task and provide a 'reply'.
The reply will be sent to the client (user or caller task).
`,
    inputSchema: {
      type: "object",
      properties: {
        reply: { type: "string", description: "Reply for user" },
      },
    } as JSONSchema,
  } satisfies AITool;
}
