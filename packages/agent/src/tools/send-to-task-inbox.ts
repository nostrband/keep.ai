import { z } from "zod";
import { generateId } from "ai";
import { TaskStore, InboxStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";

export function makeSendToTaskInboxTool(
  taskStore: TaskStore,
  inboxStore: InboxStore,
  getContext: () => EvalContext
) {
  return {
    execute: async (opts: { id: string; message: string }) => {
      if (!opts.id || !opts.message)
        throw new Error("Input must be { id, message }");
      const task = await taskStore.getTask(opts.id);
      if (!task) throw new Error("Task not found");

      const context = getContext();
      if (!context) throw new Error("No eval context");
      if (context.type === "replier")
        throw new Error("Replier can't send to inbox");

      const id = `${context.taskThreadId}.${context.step}.${generateId()}`;
      await inboxStore.saveInbox({
        id,
        source: context.type,
        source_id: context.taskId,
        target: "worker",
        target_id: opts.id,
        timestamp: new Date().toISOString(),
        content: JSON.stringify({
          id,
          role: "assistant",
          content: opts.message,
        }),
        handler_thread_id: "",
        handler_timestamp: "",
      });

      // Return void - message sent successfully
    },
    description: "Send a message to task inbox",
    inputSchema: z.object({
      id: z.string().describe("Task id"),
      message: z.string().describe("Message for the task handler"),
    }),
  };
}