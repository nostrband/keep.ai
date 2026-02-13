import { Command } from "commander";
import { initSandbox, ReplEnv, ReplAgent, ToolWrapper, createTaskTools, getOpenRouterConfig } from "@app/agent";
import type { Sandbox } from "@app/agent";
import * as readline from "readline";
import debug from "debug";
import { createDBNode, getCurrentUser, getDBPath } from "@app/node";
import { KeepDb, KeepDbApi } from "@app/db";
import { bytesToHex } from "nostr-tools/utils";
import { randomBytes } from "@noble/hashes/utils";

const debugAgent = debug("cli:agent");

export function registerAgentCommand(program: Command): void {
  program
    .command("agent")
    .description("Run REPL agent")
    .argument("<model>", "Model name on OpenRouter")
    .action(async (model: string) => {
      await runAgentCommand(model);
    });
}

async function runAgentCommand(modelName: string): Promise<void> {
  process.stdin.setEncoding("utf8");

  const pubkey = await getCurrentUser();
  const dbPath = getDBPath(pubkey);
  debugAgent("Connecting to database:", dbPath);

  const dbInterface = await createDBNode(dbPath);
  const keepDB = new KeepDb(dbInterface);

  // Initialize database
  await keepDB.start();
  debugAgent("Database initialized");

  // Create store instances
  const api = new KeepDbApi(keepDB);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout.isTTY ? process.stdout : undefined,
    crlfDelay: Infinity,
    terminal: process.stdin.isTTY,
  });

  let sandbox: Sandbox | undefined;
  let encounteredError = false;

  try {
    sandbox = await initSandbox();
    debugAgent("Sandbox initialized");

    sandbox.context = {
      step: 0,
      taskId: "",
      taskThreadId: "",
      type: "worker",
      cost: 0,
      createEvent: async () => {},
      onLog: async () => {},
    };

    const tools = createTaskTools({ api, getContext: () => sandbox!.context! });
    const toolWrapper = new ToolWrapper({
      tools,
      api,
      getContext: () => sandbox!.context!,
    });
    const sandboxGlobal = await toolWrapper.createGlobal();
    sandbox.setGlobal(sandboxGlobal);
    console.log("global", sandboxGlobal);
    console.log("tools", toolWrapper.docs);

    const task = {
      id: "",
      type: "worker" as const,
      timestamp: 0,
      reply: "",
      state: "",
      thread_id: "",
      error: "",
      title: "",
      chat_id: "",
      workflow_id: "",
      asks: "",
    };
    const env = new ReplEnv(api, "worker", task, toolWrapper.docs);

    debugAgent("modelName", modelName);
    const { apiKey, baseURL } = getOpenRouterConfig();

    for await (const line of rl) {
      const source = normalizeSource(line);
      if (source === undefined) {
        continue;
      }

      const agentTask = {
        id: bytesToHex(randomBytes(8)),
        type: "worker" as const,
        state: { id: "", goal: "", notes: "", plan: "", asks: "" },
        chat_id: "cli",
      };
      const agent = new ReplAgent(
        { modelName, apiKey, baseURL },
        env,
        sandbox,
        agentTask,
        ""
      );

      try {
        const reply = await agent.loop([source]);
        console.log("reply", reply);
      } catch (error) {
        encounteredError = true;
        console.error("Unexpected error:", error);
        debugAgent("Unexpected error", error);
      }
    }
  } catch (error) {
    encounteredError = true;
    console.error("❌ Agent failed:", error);
    debugAgent("Agent failed", error);
  } finally {
    rl.close();
    sandbox?.dispose();
    debugAgent("Sandbox disposed");
    if (encounteredError) {
      process.exitCode = 1;
    }
  }
}

function normalizeSource(line: string): string | undefined {
  if (!line) {
    return undefined;
  }
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return line;
}
