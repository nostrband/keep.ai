import { z } from "zod";
import { ChatStore, TaskStore } from "@app/db";
import { ChatAgentEvent } from "packages/proto/dist";

export function makeListEventsTool(chatStore: ChatStore, taskStore: TaskStore) {
  return {
    execute: async (opts?: { limit: number }) => {
      const events = await chatStore.getChatEvents({
        // default limit
        limit: 3,
        // copy other options
        ...opts,
        // override thread
        chatId: "main",
      });

      const taskIds = events
        .filter((e) => e.type !== "message")
        .map((e) => (e.content as ChatAgentEvent).task_id);

      const tasks = await taskStore.getTasks(taskIds);
      const states = await taskStore.getStates(taskIds);
      for (const e of events) {
        if (e.type === "message") continue;
        const agentEvent = e.content as ChatAgentEvent;
        const task = tasks.find((t) => t.id === agentEvent.task_id);
        if (task) {
          const state = states.find((s) => s.id === task.id);
          agentEvent.task = {
            id: task.id,
            title: task.title,
            type: task.type,
            state: task.state,
            reply: task.reply,
            goal: state?.goal || "",
            asks: state?.asks || "",
          };
        }
      }

      return events;
    },
    description:
      "Get list of recent events (messages and actions) exchanged with user, oldest-first.",
    inputSchema: z
      .object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Number of most recent events to fetch"),
      })
      .optional()
      .nullable(),
    outputSchema: z.array(
      z.object({
        id: z.string().describe("Id of event"),
        type: z.string().describe("Type of event"),
        timestamp: z.string().describe("Event time"),
        content: z.union([
          z.object({
            id: z.string().describe("Message id"),
            metadata: z.object({
              createdAt: z.string().describe("Date and time of message"),
            }),
            role: z
              .string()
              .describe("Message author's role - 'user' or 'assistant'"),
            parts: z.array(
              z.object({
                type: z.string().describe("Type of part, 'text' or others"),
                text: z.string().describe("Text of the part"),
              })
            ),
          }),
          z.object({
            task_id: z.string().describe("Id of task that generated event"),
            task_run_id: z
              .string()
              .describe("Id of task run that generated event"),
          }),
        ]),
      })
    ),
  };
}
