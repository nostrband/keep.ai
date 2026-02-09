import { EvalResult, Sandbox } from "./sandbox/sandbox";
import { StepInput, StepOutput, AgentTask } from "./agent-types";
import { AssistantUIMessage, LanguageModelUsage, UIMessagePart } from "@app/proto";
import debug from "debug";
import { AgentEnv } from "./agent-env";
import { makeEvalTool } from "./ai-tools/eval";
import { makeFinishTool } from "./ai-tools/finish";
import { makeAskTool } from "./ai-tools/ask";
import { makeSaveTool } from "./ai-tools/save";
import { makeScheduleTool } from "./ai-tools/schedule";
import { makeFixTool } from "./ai-tools/fix";
import { AITool } from "./ai-tools/types";

export const ERROR_BAD_REQUEST = "BAD_REQUEST";
export const ERROR_PAYMENT_REQUIRED = "PAYMENT_REQUIRED";

// Hard limit
const MAX_STEPS = 100;

// --- OpenAI-compatible message types ---

interface OpenAITextContent {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAITextContent[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: string;
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
      reasoning?: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  // OpenRouter-specific
  [key: string]: any;
}

// --- Conversion helpers ---

function convertHistoryToOpenAIMessages(
  system: string,
  history: AssistantUIMessage[],
  cacheIndex: number
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];

  // System message
  messages.push({ role: "system", content: system });

  for (const msg of history) {
    if (!msg.parts || msg.parts.length === 0) continue;

    if (msg.role === "user") {
      // Extract text from user message parts
      const textParts = msg.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text);
      if (textParts.length > 0) {
        messages.push({ role: "user", content: textParts.join("\n") });
      }
    } else if (msg.role === "assistant") {
      // Walk parts, splitting by step-start boundaries
      let currentText = "";
      let currentToolCalls: OpenAIToolCall[] = [];
      let pendingToolResults: OpenAIMessage[] = [];

      const flushAssistant = () => {
        if (currentText || currentToolCalls.length > 0) {
          const assistantMsg: OpenAIMessage = { role: "assistant" };
          if (currentText) assistantMsg.content = currentText;
          if (currentToolCalls.length > 0)
            assistantMsg.tool_calls = [...currentToolCalls];
          messages.push(assistantMsg);

          // Tool results follow their assistant message
          messages.push(...pendingToolResults);

          currentText = "";
          currentToolCalls = [];
          pendingToolResults = [];
        }
      };

      for (const part of msg.parts) {
        if (part.type === "step-start") {
          flushAssistant();
        } else if (part.type === "text") {
          currentText += (part as any).text;
        } else if (part.type === "reasoning") {
          // Reasoning parts are not sent back to the model
        } else if (
          part.type !== "file" &&
          part.type !== "source-url" &&
          "toolCallId" in part
        ) {
          // Tool call/result part
          const toolPart = part as any;
          if (toolPart.state === "result" || toolPart.state === "call") {
            currentToolCalls.push({
              id: toolPart.toolCallId,
              type: "function",
              function: {
                name: toolPart.type,
                arguments: JSON.stringify(toolPart.input || {}),
              },
            });
            // Add tool result message
            const output =
              toolPart.errorText ||
              (typeof toolPart.output === "string"
                ? toolPart.output
                : JSON.stringify(toolPart.output ?? ""));
            pendingToolResults.push({
              role: "tool",
              tool_call_id: toolPart.toolCallId,
              content: output,
            });
          }
        }
      }
      flushAssistant();
    }
  }

  // Apply cache_control at cacheIndex
  if (cacheIndex >= 0 && cacheIndex < messages.length) {
    const msg = messages[cacheIndex];
    if (typeof msg.content === "string") {
      msg.content = [
        {
          type: "text",
          text: msg.content,
          cache_control: { type: "ephemeral" },
        },
      ];
    } else if (Array.isArray(msg.content) && msg.content.length > 0) {
      msg.content[msg.content.length - 1].cache_control = {
        type: "ephemeral",
      };
    }
  }

  return messages;
}

function convertToolDefsToOpenAI(
  tools: Record<string, AITool>
): OpenAIToolDef[] {
  return Object.entries(tools).map(([name, tool]) => ({
    type: "function" as const,
    function: {
      name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

async function callOpenRouter(config: {
  apiKey: string;
  baseURL: string;
  modelName: string;
  messages: OpenAIMessage[];
  tools?: OpenAIToolDef[];
  temperature?: number;
}): Promise<{
  message: OpenRouterResponse["choices"][0]["message"];
  finish_reason: string;
  usage?: OpenRouterResponse["usage"];
  cost?: number;
}> {
  const body: any = {
    model: config.modelName,
    messages: config.messages,
    temperature: config.temperature ?? 0.1,
    usage: { include: true },
  };
  if (config.tools && config.tools.length > 0) {
    body.tools = config.tools;
  }

  const resp = await fetch(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err: any = new Error(
      `OpenRouter API error ${resp.status}: ${text}`
    );
    err.statusCode = resp.status;
    throw err;
  }

  const data: OpenRouterResponse = await resp.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error("OpenRouter returned no choices");
  }

  const choice = data.choices[0];
  return {
    message: choice.message,
    finish_reason: choice.finish_reason,
    usage: data.usage,
    cost: data.usage ? (data as any).cost : undefined,
  };
}

// --- Agent class ---

export class Agent {
  public readonly history: AssistantUIMessage[] = [];
  public readonly usage: LanguageModelUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
  public openRouterUsage = { cost: 0 };
  /** Whether the fix tool was called during the agent loop (maintainer only) */
  public fixCalled = false;
  private modelName: string;
  private apiKey: string;
  private baseURL: string;
  private env: AgentEnv;
  private sandbox: Sandbox;
  private readonly task: AgentTask;
  private readonly taskRunId: string;
  private asks?: string;
  private debug = debug("agent:Agent");

  constructor(
    config: { modelName: string; apiKey: string; baseURL: string },
    env: AgentEnv,
    sandbox: Sandbox,
    task: AgentTask,
    taskRunId: string
  ) {
    this.modelName = config.modelName;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.sandbox = sandbox;
    this.env = env;
    this.task = task;
    this.taskRunId = taskRunId;
    if (task.asks) this.asks = task.asks;
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
    const user = await this.env.buildUser(this.task.id, input, this.asks);
    if (user) {
      const userMessage: AssistantUIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: user }],
        metadata: {
          createdAt: new Date().toISOString(),
          volatile: true,
        },
      };
      this.history.push(userMessage);
    }

    // Find cache boundary (first volatile message)
    const volatileIndex = this.history.findIndex((m) => m.metadata?.volatile);
    // +1 for system message prepended
    const cacheIndex = volatileIndex >= 0 ? volatileIndex : -1;

    // Loop variables
    let jsState = opts?.jsState;
    let lastCode: string = "";
    let output: StepOutput | undefined;
    let stopped = false;

    const tools: Record<string, AITool> = {
      eval: makeEvalTool({
        sandbox: this.sandbox,
        type: this.task.type,
        getState: () => jsState,
        setResult: (result, code) => {
          input.result = result;
          lastCode = code;
          input.reason = "code";
          if (result.ok && result.state) jsState = result.state;
        },
        getLogs: opts?.getLogs || (() => ""),
      }),
    };
    tools.finish = makeFinishTool({
      onFinish: (info) => {
        stopped = true;
        output = {
          kind: "done",
          reply: info.reply || "",
          steps: input.step + 1,
        };
      },
    });

    if (this.task.type === "maintainer") {
      if (!this.task.maintainerContext) {
        throw new Error("Maintainer task requires maintainerContext");
      }
      tools.fix = makeFixTool({
        maintainerTaskId: this.task.id,
        workflowId: this.task.maintainerContext.workflowId,
        expectedScriptId: this.task.maintainerContext.expectedScriptId,
        scriptStore: this.env.api.scriptStore,
        onCalled: () => {
          this.fixCalled = true;
        },
      });
    } else {
      tools.ask = makeAskTool({
        onAsk: (info) => {
          if (!info.asks) throw new Error("Asks not provided");
          stopped = true;
          output = {
            kind: "wait",
            steps: input.step + 1,
            patch: {
              asks: info.formattedAsks,
            },
          };
        },
      });
      tools.save = makeSaveTool({
        taskId: this.task.id,
        taskRunId: this.taskRunId,
        chatId: this.task.chat_id,
        scriptStore: this.env.api.scriptStore,
        chatStore: this.env.api.chatStore,
      });
      tools.schedule = makeScheduleTool({
        taskId: this.task.id,
        scriptStore: this.env.api.scriptStore,
      });
    }

    // Convert tool definitions for OpenAI format
    const openAITools = convertToolDefsToOpenAI(tools);

    // Create assistant message upfront — will be updated incrementally
    const assistantMessage: AssistantUIMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [],
      metadata: {
        createdAt: new Date().toISOString(),
      },
    };
    this.history.push(assistantMessage);

    try {
      // Agent loop
      while (!stopped) {
        // Update step input
        input.now = new Date().toISOString();
        output = undefined;

        if (this.sandbox.context) {
          this.sandbox.context = {
            ...this.sandbox.context,
            step: input.step,
          };
        }
        this.debug("step", input.step, "input", input);

        // Convert history to OpenAI messages
        // Exclude the last assistant message (it's our accumulator, not history for the model)
        const historyForModel = this.history.slice(0, -1);
        const messages = convertHistoryToOpenAIMessages(
          system,
          historyForModel,
          cacheIndex
        );

        // If we have accumulated parts from prior steps, build an assistant + tool messages
        // from those parts so the model sees its own prior output
        if (assistantMessage.parts.length > 0) {
          const priorStepMessages = convertHistoryToOpenAIMessages(
            "",
            [assistantMessage],
            -1
          );
          // Remove the empty system message from the helper
          messages.push(...priorStepMessages.slice(1));
        }

        this.debug("llm request messages count", messages.length);

        // Call OpenRouter
        const result = await callOpenRouter({
          apiKey: this.apiKey,
          baseURL: this.baseURL,
          modelName: this.modelName,
          messages,
          tools: openAITools,
          temperature: this.env.temperature,
        });

        // Track usage
        if (result.usage) {
          this.updateUsageFromOpenRouter(result.usage);
        }
        if (result.cost != null) {
          this.openRouterUsage.cost += result.cost;
        }

        this.debug(
          "step",
          input.step,
          "finish_reason",
          result.finish_reason,
          "usage",
          result.usage
        );

        // Step start marker
        if (input.step > 0) {
          assistantMessage.parts.push({ type: "step-start" });
        }

        // Parse response — add text part
        if (result.message.content) {
          assistantMessage.parts.push({
            type: "text",
            text: result.message.content,
          });
        }

        // Parse reasoning
        if (result.message.reasoning) {
          assistantMessage.parts.push({
            type: "reasoning",
            text: result.message.reasoning,
          });
        }

        // Handle tool calls
        if (
          result.message.tool_calls &&
          result.message.tool_calls.length > 0
        ) {
          for (const tc of result.message.tool_calls) {
            const toolName = tc.function.name;
            const toolImpl = tools[toolName];

            if (!toolImpl) {
              // Unknown tool — add error part
              assistantMessage.parts.push({
                type: toolName,
                toolCallId: tc.id,
                state: "result",
                input: {},
                errorText: `Unknown tool: ${toolName}`,
              } as UIMessagePart);
              continue;
            }

            let toolInput: any;
            try {
              toolInput = JSON.parse(tc.function.arguments);
            } catch {
              toolInput = {};
            }

            // Add tool call part
            const toolPart: UIMessagePart = {
              type: toolName,
              toolCallId: tc.id,
              state: "call",
              input: toolInput,
            } as UIMessagePart;
            assistantMessage.parts.push(toolPart);

            // Execute tool
            try {
              const toolOutput = await toolImpl.execute(toolInput);
              // Update part to result state
              (toolPart as any).state = "result";
              (toolPart as any).output = toolOutput;
            } catch (toolError) {
              (toolPart as any).state = "result";
              (toolPart as any).errorText =
                toolError instanceof Error
                  ? toolError.message
                  : String(toolError);
            }
          }
        }

        // Consumed
        input.inbox.length = 0;

        // Determine step output
        if (result.finish_reason === "stop") {
          if (!output) {
            output = {
              steps: input.step + 1,
              kind: "done",
              reply: result.message.content || "",
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
        output.reasoning = result.message.reasoning;

        this.debug("step", input.step, "output", output);

        // onStep handler
        if (opts?.onStep) {
          this.debug("step", input.step, "onStep calling");
          const info = await opts.onStep(
            input.step,
            input,
            output,
            input.result
          );
          if (!info.proceed) stopped = true;
          if (info.inbox) input.inbox = [...info.inbox];
          this.debug(
            "step",
            input.step,
            "onStep done, proceed:",
            info.proceed,
            "stopped:",
            stopped
          );
        }

        // Check stop conditions
        if (result.finish_reason === "stop" && !stopped) {
          stopped = true;
        }

        // Enforce hard limit
        if (input.step >= MAX_STEPS) stopped = true;

        this.debug(
          "step",
          input.step,
          "loop iteration done, stopped:",
          stopped
        );

        input.step++;
      }

      this.debug("llm finish message:", JSON.stringify(assistantMessage, null, 2));

      if (!output) throw new Error("LLM failed to generate output");

      // @ts-ignore
      this.debug("openRouterUsage", this.openRouterUsage);
    } catch (err: any) {
      this.debug("Error", err);
      if (err?.statusCode === 402) {
        throw ERROR_PAYMENT_REQUIRED;
      } else if (err?.statusCode === 400) {
        throw ERROR_BAD_REQUEST;
      } else {
        throw err;
      }
    }

    if (!output) throw new Error("Failed to request llm");

    return output;
  }

  private updateUsageFromOpenRouter(usage: NonNullable<OpenRouterResponse["usage"]>) {
    this.debug("Token Usage", JSON.stringify(usage));
    this.usage.inputTokens += usage.prompt_tokens || 0;
    this.usage.outputTokens += usage.completion_tokens || 0;
    this.usage.totalTokens += usage.total_tokens || 0;
    this.usage.cachedInputTokens =
      (this.usage.cachedInputTokens || 0) +
      (usage.prompt_tokens_details?.cached_tokens || 0);
    this.usage.reasoningTokens =
      (this.usage.reasoningTokens || 0) +
      (usage.completion_tokens_details?.reasoning_tokens || 0);
  }
}
