import { z } from "zod";
import { tool } from "ai";
import { EvalResult, Sandbox } from "../sandbox/sandbox";
import { TaskType } from "../agent-types";

export function makeEvalTool(opts: {
  sandbox: Sandbox;
  type: TaskType;
  getState: () => any | undefined;
  setResult: (result: EvalResult, code: string) => void;
  getLogs: () => string;
}) {
  return tool({
    execute: async ({
      jsCode,
    }: {
      jsCode: string;
    }): Promise<{ result: string; logs: string }> => {
      if (!jsCode) throw new Error("Required 'jsCode' param");

      try {
        // Eval
        const result = await opts.sandbox.eval(jsCode, {
          // worker can run for long time,
          // calls to Images.transform etc are very slow
          timeoutMs:
            opts.type === "worker" || opts.type === "planner" ? 300000 : 5000,
          state: opts.getState(),
        });

        // Execution logs
        const logs = opts.getLogs();

        // Set results & state
        opts.setResult(result, jsCode);

        // Return result
        if (result.ok)
          return {
            result: JSON.stringify(result.result),
            logs: opts.getLogs(),
          };

        const error = `
Logs: ${logs}
Error: ${result.error}
`;
        throw error;
      } catch (e) {
        const logs = opts.getLogs();
        const error = `
Logs: ${logs}
Error: ${e}
`;
        throw error;
      }
    },
    description: `Execute JS code in a sandbox to access APIs and process data.

Guidelines:
- no fetch, no console.log/error, no direct network or disk, no Window, no Document, etc
- do not wrap your code in '(async () => {...})()' - that's already done for you
- all API endpoints are async and must be await-ed
- you MUST 'return' the value that you want to be returned from 'eval' tool
- you MAY set 'globalThis.state' to any value that you want to preserve and make available on the next code step
- all global variables are reset after code eval ends, use 'state' to keep data for next steps
- returned value and 'state' must be convertible to JSON
- don't 'return' big encrypted/encoded/intermediary data/fields - put them to 'state' to save tokens and process on next steps
`,
    inputSchema: z.object({
      jsCode: z.string().describe("JS code"),
    }),
    outputSchema: z.object({
      result: z.string().describe("JSON value of returned 'result' field"),
      logs: z.string().describe("Execution logs"),
    }),
  });
}
