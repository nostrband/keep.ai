import { z } from "zod";
import { InboxStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";

export function makePostponeInboxItemTool(
  inboxStore: InboxStore,
  getContext: () => EvalContext
) {
  return {
    execute: async (opts: { id: string; datetime: string }) => {
      if (!opts.id || !opts.datetime)
        throw new Error("Input must be { id, datetime }");

      const context = getContext();
      if (!context) throw new Error("No eval context");
      if (context.type !== "replier")
        throw new Error("Only replier can postpone inbox items");

      await inboxStore.postponeItem(opts.id, opts.datetime);

      // Return void - item postponed successfully
    },
    description: "Postpone an inbox item to re-consider it at a later time",
    inputSchema: z.object({
      id: z.string().describe("Inbox item id"),
      datetime: z.string().describe("Future timestamp for the inbox item (ISO string)"),
    }),
  };
}