import { initSandbox } from "@app/node";
import {
  makeCreateNoteTool,
  makeDeleteNoteTool,
  makeGetNoteTool,
  makeGetWeatherTool,
  makeListNotesTool,
  makeSearchNotesTool,
  makeUpdateNoteTool,
} from "./tools";
import { z, ZodFirstPartyTypeKind as K } from "zod";
import { KeepDbApi } from "packages/db/dist";

export async function createAgentSandbox(api: KeepDbApi) {
  const sandbox = await initSandbox();

  const docs: any = {};
  const addTool = (global: any, ns: string, name: string, tool: any) => {
    if (!(ns in global)) global[ns] = {};
    global[ns][name] = tool.execute;
    if (!("docs" in global)) global["docs"] = {};
    if (!(ns in global["docs"])) global["docs"][ns] = {};
    let desc = ["===Description===", tool.description];
    if (tool.inputSchema)
      desc.push(...["===Input===", printSchema(tool.inputSchema)]);
    if (tool.outputSchema)
      desc.push(...["===Output===", printSchema(tool.outputSchema)]);
    docs[ns + "." + name] = desc.join("\n");
  };

  const global: any = {};
  // Docs function
  global.docs = (name: string) => {
    if (name in docs) return docs[name];
    let result = "";
    for (const key of Object.keys(docs)) {
      if (key.startsWith(name)) {
        result += "# " + key + "\n" + docs[key] + "\n\n";
      }
    }
    if (result) return result;
    throw new Error("Not found " + name);
  };
  // Tools
  addTool(global, "tools", "getWeatherAsync", makeGetWeatherTool());
  addTool(global, "memory", "getNoteAsync", makeGetNoteTool(api.noteStore));
  addTool(global, "memory", "listNotesAsync", makeListNotesTool(api.noteStore));
  addTool(
    global,
    "memory",
    "searchNotesAsync",
    makeSearchNotesTool(api.noteStore)
  );
  addTool(
    global,
    "memory",
    "createNoteAsync",
    makeCreateNoteTool(api.noteStore)
  );
  addTool(
    global,
    "memory",
    "updateNoteAsync",
    makeUpdateNoteTool(api.noteStore)
  );
  addTool(
    global,
    "memory",
    "deleteNoteAsync",
    makeDeleteNoteTool(api.noteStore)
  );
  addTool(global, "memory", "listMessagesAsync", {
    execute: async (opts?: { limit: number }) => {
      return await api.memoryStore.getMessages({
        // default limit
        limit: 10,
        // copy other options
        ...opts,
        // override thread
        threadId: "main",
      });
    },
    description: "Get list of messages exchanged with user, most-recent-first.",
    inputSchema: z.object({
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Number of most recent user messages to fetch"),
    }),
    outputSchema: z.array(
      z.object({
        id: z.string().describe("Id of message"),
        metadata: z.object({
          createdAt: z.string().describe("Date and time of message"),
        }),
        role: z
          .string()
          .describe("Message author's role - 'user' or 'assistant'"),
        parts: z.array(
          z.object({
            type: z.string().describe("Type of part, 'text' or others"),
            text: z.string().describe("Text of message part"),
          })
        ),
      })
    ),
  });

  sandbox.setGlobal(global);

  return sandbox;
}

type Any = z.ZodTypeAny;

export const printSchema = (schema: Any): string => {
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
      return `array<${printSchema(inner)}>`;
    }

    case K.ZodOptional:
      return `${printSchema((schema as z.ZodOptional<Any>)._def.innerType)}?`;

    case K.ZodNullable:
      return `${printSchema(
        (schema as z.ZodNullable<Any>)._def.innerType
      )} | null`;

    case K.ZodDefault:
      return `${printSchema(
        (schema as z.ZodDefault<Any>)._def.innerType
      )} (default)`;

    case K.ZodPromise:
      return `Promise<${printSchema((schema as z.ZodPromise<Any>)._def.type)}>`;

    case K.ZodUnion:
      return (schema as z.ZodUnion<[Any, ...Any[]]>)._def.options
        .map(printSchema)
        .join(" | ");

    case K.ZodIntersection: {
      const s = schema as z.ZodIntersection<Any, Any>;
      return `${printSchema(s._def.left)} & ${printSchema(s._def.right)}`;
    }

    case K.ZodRecord: {
      const s = schema as z.ZodRecord<Any, Any>;
      return `{ [key: ${printSchema(s._def.keyType)}]: ${printSchema(
        s._def.valueType
      )} }`;
    }

    case K.ZodTuple:
      return `[${(schema as z.ZodTuple)._def.items
        .map(printSchema)
        .join(", ")}]`;

    case K.ZodObject: {
      const obj = schema as z.ZodObject<any>;
      // In Zod v3, the shape is a function on _def:
      const shape = obj._def.shape();
      const body = Object.entries(shape)
        .map(([k, v]) => `${k}: ${printSchema(v as Any)}`)
        .join("; ");
      return `{ ${body} }`;
    }

    case K.ZodDiscriminatedUnion: {
      const du = schema as z.ZodDiscriminatedUnion<string, any>;
      // options is a Map in Zod; get its values:
      const options: any[] = Array.from(du._def.options.values());
      return options.map(printSchema).join(" | ");
    }

    case K.ZodEffects: {
      // If you want to "ignore" refinements/transforms for printing:
      const inner = (schema as z.ZodEffects<Any>)._def.schema;
      return printSchema(inner);
    }

    case K.ZodBranded: {
      const inner = (schema as z.ZodBranded<Any, any>)._def.type;
      return `${printSchema(inner)} /* branded */`;
    }

    default:
      // Fallback: show the Zod kind
      return t.replace("Zod", "").toLowerCase();
  }
};
