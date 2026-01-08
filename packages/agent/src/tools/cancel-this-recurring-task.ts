import { z } from "zod";
import { EvalContext } from "../sandbox/sandbox";

export function makeCancelThisRecurringTaskTool(
  getContext: () => EvalContext
) {
  return {
    execute: async () => {
      const context = getContext();
      if (!context) throw new Error("No eval context");
      // FIXME remove worker
      if (context.type !== "worker" && context.type !== "planner") 
        throw new Error("Only planner/worker tasks can cancel themselves");

      if (!context.data) context.data = {};
      context.data.cancelled = true;

      await getContext().createEvent("cancel_this_task_cron", {});

      // Return void - task cancelled successfully
    },
    description: "Cancel this recurring task",
    inputSchema: z.object({}), // No params accepted
  };
}