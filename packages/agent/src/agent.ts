import { EvalResult, Sandbox } from "./sandbox/sandbox";
import { StepInput, StepOutput, AgentTask, TaskState } from "./agent-types";
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
import { AgentEnv } from "./agent-env";
import { APICallError, LanguageModelV2Usage } from "@ai-sdk/provider";
import { makeEvalTool } from "./ai-tools/eval";
import { makeFinishTool } from "./ai-tools/finish";
import { makeAskTool } from "./ai-tools/ask";
import { makeSaveTool } from "./ai-tools/save";
import { makeScheduleTool } from "./ai-tools/schedule";

export const ERROR_BAD_REQUEST = "BAD_REQUEST";
export const ERROR_PAYMENT_REQUIRED = "PAYMENT_REQUIRED";

// Hard limit
const MAX_STEPS = 100;

export class Agent {
  public readonly history: AssistantUIMessage[] = [];
  public readonly usage: LanguageModelV2Usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
  public openRouterUsage = { cost: 0 };
  private model: LanguageModel;
  private env: AgentEnv;
  private sandbox: Sandbox;
  private readonly task: AgentTask;
  private readonly taskRunId: string;
  private state?: TaskState;
  private debug = debug("agent:Agent");

  constructor(
    model: LanguageModel,
    env: AgentEnv,
    sandbox: Sandbox,
    task: AgentTask,
    taskRunId: string
  ) {
    this.model = model;
    this.sandbox = sandbox;
    this.env = env;
    this.task = task;
    this.taskRunId = taskRunId;
    if (task.state) this.state = { ...task.state };
  }

  async loop(
    inbox: string[],
    opts?: {
      history?: AssistantUIMessage[];
      jsState?: any;
      getLogs?: () => string;
      onStep?: (
        step: number,
        input: StepInput,
        output?: StepOutput,
        result?: EvalResult
      ) => Promise<{ proceed: boolean; inbox?: string[] }>;
    }
  ) {
    if (!inbox.length) throw new Error("Empty inbox for agent");

    // Prepare context
    if (opts?.history) this.history.push(...opts.history);

    // System prompt
    const system = await this.env.buildSystem();

    // Initial input
    const input: StepInput = {
      step: 0,
      reason: "input",
      now: new Date().toISOString(),
      inbox: [...inbox],
    };

    // Context
    const contexts = await this.env.buildContext(input);
    for (const c of contexts) {
      this.history.push(c);
    }

    // New user messages
    for (const s of input.inbox) {
      const msg = JSON.parse(s) as AssistantUIMessage;
      this.history.push(this.env.prepareUserMessage(msg));
    }

    // Custom user message (worker)
    const user = await this.env.buildUser(this.task.id, input, this.state);
    if (user) {
      // Append to history
      const userMessage: AssistantUIMessage = {
        id: generateId(),
        role: "user",
        parts: [{ type: "text", text: user }],
        metadata: {
          createdAt: new Date().toISOString(),
          volatile: true,
        },
      };

      // Put user message to history
      this.history.push(userMessage);
    }

    // Convert messages to LLM format
    const messages: ModelMessage[] = [
      { role: "system", content: system },
      ...convertToModelMessages(this.history.filter((m) => !!m.parts)),
    ];

    const volatileIndex = this.history.findIndex((m) => m.metadata?.volatile);
    // Add +1 to volatileIndex due to preprended system message
    const cachedIndex = volatileIndex >= 0 ? volatileIndex : -1;

    // Set caching marker for anthropic at pre-last message
    messages.at(cachedIndex)!.providerOptions = {
      openrouter: {
        cacheControl: { type: "ephemeral" },
      },
    };

    this.debug("llm request messages", JSON.stringify(messages, null, 2));

    // Loop variables
    let jsState = opts?.jsState;
    let lastCode: string = "";
    let output: StepOutput | undefined;
    let error: any;
    let stopped = false;

    const tools: any = {
      eval: makeEvalTool({
        sandbox: this.sandbox,
        type: this.task.type,
        getState: () => jsState,
        setResult: (result, code) => {
          // Store
          input.result = result;
          lastCode = code;

          // Next step reason
          input.reason = "code";

          // Update state
          if (result.ok && result.state) jsState = result.state;
        },
        getLogs: opts?.getLogs || (() => ""),
      }),
    };
    tools.finish = makeFinishTool({
      onFinish: (info) => {
        // Stop the loop
        stopped = true;

        // 'done' output
        output = {
          kind: "done",
          reply: info.reply || "",
          steps: input.step + 1,
        };
        if (info.notes || info.plan) {
          output.patch = {
            notes: info.notes,
            plan: info.plan,
          };
        }
      },
    });
    tools.ask = makeAskTool({
      onAsk: (info) => {
        if (!info.asks) throw new Error("Asks not provided");

        // Stop the loop
        stopped = true;

        // 'wait' output
        // Use formattedAsks which includes options as JSON if provided
        output = {
          kind: "wait",
          steps: input.step + 1,
          patch: {
            notes: info.notes,
            plan: info.plan,
            asks: info.formattedAsks,
          },
        };
      },
    });
    tools.save = makeSaveTool({
      taskId: this.task.id,
      taskRunId: this.taskRunId,
      scriptStore: this.env.api.scriptStore,
      chatStore: this.env.api.chatStore,
    });
    tools.schedule = makeScheduleTool({
      taskId: this.task.id,
      scriptStore: this.env.api.scriptStore,
    });

    try {
      // Call LLM
      const result = streamText({
        model: this.model,
        temperature: this.env.temperature,
        messages,
        providerOptions: {
          openrouter: {
            // reasoning: {
            //   max_tokens: 500,
            // },
          },
        },
        tools,
        stopWhen: () => stopped,
        prepareStep: (opts) => {
          // Update input
          input.step = opts.stepNumber;
          input.now = new Date().toISOString();

          // Reset
          output = undefined;

          // Update context
          if (this.sandbox.context) {
            this.sandbox.context = {
              ...this.sandbox.context,
              step: input.step,
            };
          }
          this.debug("step", input.step, "input", input);

          // NOTE: can change model, tools, system prompt and all input messages
          return undefined;
        },
        onStepFinish: async (stepResult) => {
          // Consumed
          input.inbox.length = 0;

          // console.log("step", input.step, "request", stepResult.request.body);

          if (stepResult.providerMetadata?.openrouter) {
            this.debug(
              "step",
              input.step,
              "openrouter usage",
              stepResult.providerMetadata?.openrouter?.usage
            );

            this.openRouterUsage.cost +=
              // @ts-ignore
              stepResult.providerMetadata?.openrouter?.usage?.cost || 0;
          }
          // console.log("response", stepResult.response.messages);

          if (stepResult.finishReason === "stop") {
            // If task doesn't call 'pause' or 'finish' then
            // the default reply is 'done'
            if (!output) {
              output = {
                steps: input.step + 1,
                kind: "done",
                reply: stepResult.text,
              };
            }
          } else {
            if (!output) {
              output = {
                kind: "code",
                steps: input.step + 1,
                code: lastCode,
              };
            }
          }

          // Save reasoning
          output.reasoning = stepResult.reasoningText;

          this.debug("step", input.step, "output", output);

          // onStep handler
          if (opts?.onStep) {
            const info = await opts.onStep(
              input.step,
              input,
              output,
              input.result
            );

            // Stop if client says so
            if (!info.proceed) stopped = true;

            // New stuff in the inbox
            if (info.inbox) input.inbox = [...info.inbox];
          }

          // Enforce hard limit
          if (input.step >= MAX_STEPS) stopped = true;
        },
        onError: (event) => {
          error = event.error;
          this.debug("onError", event.error);
        },
      });

      // Read reply into UIMessage
      let newMessage: UIMessage | undefined;
      for await (const uiMessage of readUIMessageStream({
        stream: result.toUIMessageStream(),
      })) {
        // @ts-ignore
        newMessage = uiMessage;
      }
      if (!newMessage) {
        this.debug("No streamed reply", await result.content);
        throw new Error("Failed to get streamed reply");
      }

      this.debug("llm finish message:", JSON.stringify(newMessage, null, 2));

      if (!output) throw new Error("LLM failed to generate output");

      // Put reply to history
      this.history.push({
        ...newMessage,
        id: generateId(),
        metadata: {
          createdAt: new Date().toISOString(),
        },
      });

      this.updateUsage(await result.usage);

      // @ts-ignore
      this.debug("openRouterUsage", this.openRouterUsage);
    } catch (err) {
      if (error) err = error;

      this.debug("Error", err);
      if (APICallError.isInstance(err)) {
        if ((err as APICallError).statusCode === 402) {
          throw ERROR_PAYMENT_REQUIRED;
        } else if ((err as APICallError).statusCode === 400) {
          throw ERROR_BAD_REQUEST;
        } else {
          throw err;
        }
      }
    }

    if (!output) throw new Error("Failed to request llm");

    return output;
  }

  private updateUsage(usage: LanguageModelV2Usage) {
    this.debug("Token Usage", JSON.stringify(usage));
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
