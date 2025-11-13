import { EvalResult, Sandbox } from "./sandbox/sandbox";
import {
  StepInput,
  StepOutput,
  StepReason,
  Task,
  TaskAgent,
} from "./task-agent";
import { LanguageModel } from "ai";
import { AssistantUIMessage } from "@app/proto";

// Hard limit
const MAX_STEPS = 100;

export class ReplAgent {
  public readonly agent: TaskAgent;
  private sandbox: Sandbox;

  constructor(model: LanguageModel, sandbox: Sandbox, task: Task) {
    this.sandbox = sandbox;
    this.agent = new TaskAgent({
      model,
      task,
      env: {
        tools: [...sandbox.tools],
      },
    });
  }

  async loop(
    reason?: "start" | "input" | "timer",
    opts?: {
      history?: AssistantUIMessage[],
      inbox?: string[];
      onStep?: (
        step: number,
        input: StepInput,
        output?: StepOutput,
        result?: EvalResult
      ) => Promise<{ proceed: boolean; inbox?: string[] }>;
    }
  ) {

    // Prepare context
    if (opts?.history) this.agent.history.push(...opts.history);
    let inbox = [...(opts?.inbox || [])];
    
    // Step state
    let stepReason: StepReason = reason || "start";
    let stepResult: EvalResult | undefined;

    // Loop over steps
    for (let step = 0; step < MAX_STEPS; step++) {
      const input: StepInput = {
        step,
        reason: stepReason,
        now: new Date().toISOString(),
        inbox: [...inbox],
        result: stepResult,
      };

      // Consumed
      inbox.length = 0;

      // Run the step
      console.log("step", step, "input", input);
      let output: StepOutput | undefined;
      try {
        output = await this.agent.runStep(input);
        console.log("step", step, "output", output);

        switch (output.kind) {
          case "step": {
            stepResult = await this.sandbox.eval(output.code, {
              timeoutMs: 1000,
            });
            console.log("step", step, "result", stepResult);
            break;
          }
          case "done": {
            // noop, just return below
            break;
          }
          default: {
            throw new Error("Not implemented " + output.kind);
          }
        }
      } catch (e: any) {
        stepResult = {
          ok: false,
          error: e.toString(),
        };
      }

      // Notify
      if (opts?.onStep) {
        const info = await opts.onStep(step, input, output, stepResult);
        if (!info.proceed) return output;

        // New stuff in the inbox
        if (info.inbox) inbox = [...info.inbox];
      }

      // Done?
      if (output?.kind !== "step") return output;

      // Next step
      stepReason = "step";
    }
  }
}
