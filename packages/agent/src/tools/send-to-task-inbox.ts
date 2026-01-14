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
      if (task.type !== "worker" && task.type !== "planner")
        throw new Error("Can only send to planner/worker tasks");

      const context = getContext();
      if (!context) throw new Error("No eval context");
      if (context.type === "planner")
        throw new Error("Planner can't send to inbox");
      if (context.type === "workflow")
        throw new Error("Workflow can't send to inbox");

      const id = `${context.taskThreadId}.${context.step}.${generateId()}`;
      await inboxStore.saveInbox({
        id,
        source: context.type as "worker", // Only workers can use this tool
        source_id: context.taskId,
        target: task.type,
        target_id: opts.id,
        timestamp: new Date().toISOString(),
        content: JSON.stringify({
          role: "assistant",
          parts: [
            {
              type: "text",
              text: opts.message,
            },
          ],
          metadata: {
            createdAt: new Date().toISOString(),
          },
          sourceTaskType: context.type,
          sourceTaskId: context.taskId,
        }),
        handler_thread_id: "",
        handler_timestamp: "",
      });

      await context.createEvent("send_to_task_inbox", {
        target_task_id: task.id,
        target_task_title: task.title,
      });

      // Message sent successfully
      return true;
    },
    description:
      "Send a message to task inbox. Make sure to include proper context and details in your message, so that task worker wouldn't have to dig into message history to understand the user intent.",
    inputSchema: z.object({
      id: z.string().describe("Task id"),
      message: z.string().describe("Message for the task handler"),
    }),
    outputSchema: z.boolean().describe("True if sent"),
  };
}
