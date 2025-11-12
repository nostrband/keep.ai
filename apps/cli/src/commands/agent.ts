import { Command } from "commander";
import { initSandbox } from "@app/node";
import type { Sandbox } from "@app/node";
import * as readline from "readline";
import debug from "debug";
import {
  getOpenRouter,
  makeGetWeatherTool,
  ReplAgent,
  Task,
} from "packages/agent/dist";
import { z, ZodFirstPartyTypeKind as K } from "zod";

type Any = z.ZodTypeAny;

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

export const print = (schema: Any): string => {
  const t = schema._def.typeName as K;

  if (schema.description) return "<" + schema.description + ">";

  switch (t) {
    case K.ZodString:
      return "string";
    case K.ZodNumber:
      return "number";
    case K.ZodBoolean:
      return "boolean";
    case K.ZodBigInt:
      return "bigint";
    case K.ZodDate:
      return "date";
    case K.ZodUndefined:
      return "undefined";
    case K.ZodNull:
      return "null";

    case K.ZodLiteral:
      return JSON.stringify((schema as z.ZodLiteral<any>)._def.value);

    case K.ZodEnum:
      return `enum(${(
        schema as z.ZodEnum<[string, ...string[]]>
      )._def.values.join(", ")})`;

    case K.ZodNativeEnum:
      return `enum(${Object.values(
        (schema as z.ZodNativeEnum<any>)._def.values
      ).join(", ")})`;

    case K.ZodArray: {
      const inner = (schema as z.ZodArray<Any>)._def.type;
      return `array<${print(inner)}>`;
    }

    case K.ZodOptional:
      return `${print((schema as z.ZodOptional<Any>)._def.innerType)}?`;

    case K.ZodNullable:
      return `${print((schema as z.ZodNullable<Any>)._def.innerType)} | null`;

    case K.ZodDefault:
      return `${print((schema as z.ZodDefault<Any>)._def.innerType)} (default)`;

    case K.ZodPromise:
      return `Promise<${print((schema as z.ZodPromise<Any>)._def.type)}>`;

    case K.ZodUnion:
      return (schema as z.ZodUnion<[Any, ...Any[]]>)._def.options
        .map(print)
        .join(" | ");

    case K.ZodIntersection: {
      const s = schema as z.ZodIntersection<Any, Any>;
      return `${print(s._def.left)} & ${print(s._def.right)}`;
    }

    case K.ZodRecord: {
      const s = schema as z.ZodRecord<Any, Any>;
      return `{ [key: ${print(s._def.keyType)}]: ${print(s._def.valueType)} }`;
    }

    case K.ZodTuple:
      return `[${(schema as z.ZodTuple)._def.items.map(print).join(", ")}]`;

    case K.ZodObject: {
      const obj = schema as z.ZodObject<any>;
      // In Zod v3, the shape is a function on _def:
      const shape = obj._def.shape();
      const body = Object.entries(shape)
        .map(([k, v]) => `${k}: ${print(v as Any)}`)
        .join("; ");
      return `{ ${body} }`;
    }

    case K.ZodDiscriminatedUnion: {
      const du = schema as z.ZodDiscriminatedUnion<string, any>;
      // options is a Map in Zod; get its values:
      const options: any[] = Array.from(du._def.options.values());
      return options.map(print).join(" | ");
    }

    case K.ZodEffects: {
      // If you want to "ignore" refinements/transforms for printing:
      const inner = (schema as z.ZodEffects<Any>)._def.schema;
      return print(inner);
    }

    case K.ZodBranded: {
      const inner = (schema as z.ZodBranded<Any, any>)._def.type;
      return `${print(inner)} /* branded */`;
    }

    default:
      // Fallback: show the Zod kind
      return t.replace("Zod", "").toLowerCase();
  }
};

async function runAgentCommand(modelName: string): Promise<void> {
  process.stdin.setEncoding("utf8");

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

    const getWeatherTool = makeGetWeatherTool();
    const docs: any = {};
    const addTool = (global: any, ns: string, name: string, tool: any) => {
      if (!(ns in global)) global[ns] = {};
      global[ns][name] = tool.execute;
      if (!("docs" in global)) global["docs"] = {};
      if (!(ns in global["docs"])) global["docs"][ns] = {};
      let desc = ["===Description===", tool.description];
      if (tool.inputSchema)
        desc.push(...["===Input===", print(tool.inputSchema)]);
      if (tool.outputSchema)
        desc.push(...["===Output===", print(tool.outputSchema)]);
      docs[ns + "." + name] = desc.join("\n");
    };

    const global: any = {};
    // Docs function
    global.docs = (name: string) => {
      return docs[name];
    };
    // Tools
    addTool(global, "tools", "getWeatherAsync", getWeatherTool);

    console.log("global", global);
    sandbox.setGlobal(global);
    console.log("env", sandbox.env);

    // const test = await sandbox.eval("return docs('tools.getWeatherAsync')\n");
    // console.log("test", test);

    debugAgent("modelName", modelName);
    const model = getOpenRouter()(modelName);

    for await (const line of rl) {
      const source = normalizeSource(line);
      if (source === undefined) {
        continue;
      }

      const task: Task = {
        type: "router",
      };
      const agent = new ReplAgent(model, sandbox, task);
      agent.setInbox([source]);

      try {
        const reply = await agent.loop();
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
    sandbox?.[Symbol.dispose]?.();
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
