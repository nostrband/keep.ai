import { z } from "zod";
import { TaskStore } from "@app/db";
import { EvalContext } from "../sandbox/sandbox";

export function makeCancelThisRecurringTaskTool(
  taskStore: TaskStore,
  getContext: () => EvalContext
) {
  return {
    execute: async () => {
      const context = getContext();
      if (!context) throw new Error("No eval context");
      if (context.type !== "worker") 
        throw new Error("Only worker tasks can cancel themselves");

      if (!context.data) context.data = {};
      context.data.cancelled = true;

      // Return void - task cancelled successfully
    },
    description: "Cancel this recurring task",
    inputSchema: z.object({}), // No params accepted
  };
}