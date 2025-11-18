import { Command } from "commander";
import { createDBNode, getCurrentUser, getDBPath } from "@app/node";
import type { Sandbox } from "@app/agent";
import * as readline from "readline";
import debug from "debug";
import { initSandbox, ReplEnv } from "@app/agent";
import { KeepDb, KeepDbApi } from "@app/db";

const debugSandbox = debug("cli:sandbox");

export function registerSandboxCommand(program: Command): void {
  program
    .command("sandbox")
    .argument("<type>", "Task type: router | worker | replier")
    .description("Evaluate JavaScript code using the embedded sandbox runtime")
    .action(async (type) => {
      await runSandboxCommand(type);
    });
}

async function runSandboxCommand(type: string): Promise<void> {
  process.stdin.setEncoding("utf8");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout.isTTY ? process.stdout : undefined,
    crlfDelay: Infinity,
    terminal: process.stdin.isTTY,
  });

  let sandbox: Sandbox | undefined;
  let encounteredError = false;

  const pubkey = await getCurrentUser();
  const dbPath = getDBPath(pubkey);
  debugSandbox("Connecting to database:", dbPath);

  const dbInterface = await createDBNode(dbPath);
  const keepDB = new KeepDb(dbInterface);

  // Initialize database
  await keepDB.start();
  debugSandbox("Database initialized");

  // Create store instances
  const api = new KeepDbApi(keepDB);

  if (type !== "router" && type !== "worker" && type !== "replier") throw new Error("Invalid type");
  const taskType = type;

  try {
    sandbox = await initSandbox();
    sandbox.context = {
      step: 0,
      taskId: "",
      taskThreadId: "",
      type: taskType,
    };

    const env = new ReplEnv(api, taskType, () => sandbox!.context!);
    const gl = await env.createGlobal();
    console.log("global", gl);
    sandbox.setGlobal(gl);

    debugSandbox("Sandbox initialized, tools: ", env.tools);

    for await (const line of rl) {
      const source = normalizeSource(line);
      if (source === undefined) {
        continue;
      }

      try {
        const evaluation = await sandbox.eval(source, { timeoutMs: 5000 });
        if (evaluation.ok) {
          console.log(JSON.stringify(evaluation.result, null, 2));
        } else {
          encounteredError = true;
          console.error(`Error: ${evaluation.error}`);
        }
      } catch (error) {
        encounteredError = true;
        console.error("Unexpected sandbox error:", error);
        debugSandbox("Unexpected sandbox error", error);
      }
    }
  } catch (error) {
    encounteredError = true;
    console.error("❌ Sandbox command failed:", error);
    debugSandbox("Sandbox command failed", error);
  } finally {
    rl.close();
    sandbox?.dispose();
    debugSandbox("Sandbox disposed");
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
