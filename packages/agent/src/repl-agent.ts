import { EvalResult, Sandbox } from "./sandbox/sandbox";
import {
  StepInput,
  StepOutput,
  StepReason,
  AgentTask,
  TaskState,
} from "./repl-agent-types";
import {
  convertToModelMessages,
  generateId,
  LanguageModel,
  ModelMessage,
  readUIMessageStream,
  streamText,
  UIMessage,
} from "ai";
import { AssistantUIMessage } from "@app/proto";
import debug from "debug";
import { ReplEnv } from "./repl-env";
import { MspParser } from "./msp-parser";
import { getMessageText } from "./utils";
import { LanguageModelV2Usage } from "@ai-sdk/provider";

// Hard limit
const MAX_STEPS = 100;

export class ReplAgent {
  public readonly history: AssistantUIMessage[] = [];
  public readonly usage: LanguageModelV2Usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
  private model: LanguageModel;
  private env: ReplEnv;
  private sandbox: Sandbox;
  private readonly taskId: string;
  private state?: TaskState;
  private parser: MspParser;
  private debug = debug("agent:ReplAgent");

  constructor(
    model: LanguageModel,
    env: ReplEnv,
    sandbox: Sandbox,
    task: AgentTask
  ) {
    this.model = model;
    this.sandbox = sandbox;
    this.env = env;
    this.parser = new MspParser(task.type);
    this.taskId = task.id;
    if (task.state) this.state = { ...task.state };
  }

  async loop(
    reason?: "start" | "input" | "timer",
    opts?: {
      history?: AssistantUIMessage[];
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
    if (opts?.history) this.history.push(...opts.history);
    let inbox = [...(opts?.inbox || [])];

    // Step state
    let stepReason: StepReason = reason || "start";
    let stepResult: EvalResult | undefined;
    let jsState: any | undefined;

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
      this.debug("step", step, "input", input);
      let output: StepOutput | undefined;
      try {
        output = await this.runStep(input);
        this.debug("step", step, "output", output);

        if (output.kind === "code") {
          // Update step in context
          if (this.sandbox.context)
            this.sandbox.context = {
              ...this.sandbox.context,
              step,
            };

          // Eval
          stepResult = await this.sandbox.eval(output.code, {
            // web search might take long time
            timeoutMs: 10000,
            state: jsState,
          });
          this.debug("step", step, "result", stepResult);

          // Update state
          if (stepResult.ok && stepResult.state) jsState = stepResult.state;
        }
      } catch (e: any) {
        this.debug("Step error", e);
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
      if (output?.kind !== "code") return output;

      // Next step
      stepReason = "code";
    }
  }

  async runStep(input: StepInput): Promise<StepOutput> {
    const system = await this.env.buildSystem();
    const user = await this.env.buildUser(this.taskId, input, this.state);

    // New user message
    const userMessage: AssistantUIMessage = {
      id: generateId(),
      role: "user",
      parts: [{ type: "text", text: user }],
      metadata: {
        createdAt: new Date().toISOString(),
      },
    };

    // Put user message to history
    this.history.push(userMessage);

    // Input messages
    const messages: ModelMessage[] = [
      { role: "system", content: system },
      ...convertToModelMessages(this.history),
    ];
    console.log("llm request messages", JSON.stringify(messages, null, 2));

    // Call LLM
    const result = streamText({
      model: this.model,
      temperature: this.env.temperature,
      toolChoice: "none",
      messages,
    });

    // Read reply into UIMessage
    let newMessage: UIMessage | undefined;
    for await (const uiMessage of readUIMessageStream({
      stream: result.toUIMessageStream(),
    })) {
      newMessage = uiMessage;
    }
    if (!newMessage) throw new Error("Failed to get streamed reply");

    this.debug("llm response message:", JSON.stringify(newMessage, null, 2));

    // Put reply to history
    this.history.push({
      ...newMessage,
      id: generateId(),
      metadata: {
        createdAt: new Date().toISOString(),
      },
    });

    this.updateUsage(await result.usage);

    // Reply text
    const text = getMessageText(newMessage);
    // this.debug("LLM response text", text);

    // Parse reply text into output
    const output = this.parser.parse(input.step + 1, text);
    this.debug("LLM response output", output);

    return output;
  }

  private updateUsage(usage: LanguageModelV2Usage) {
    this.usage.cachedInputTokens =
      this.usage.cachedInputTokens! + (usage.cachedInputTokens || 0);
    this.usage.inputTokens = this.usage.inputTokens! + (usage.inputTokens || 0);
    this.usage.outputTokens =
      this.usage.outputTokens! + (usage.outputTokens || 0);
    this.usage.reasoningTokens =
      this.usage.reasoningTokens! + (usage.reasoningTokens || 0);
    this.usage.totalTokens = this.usage.totalTokens! + (usage.totalTokens || 0);
  }
}
