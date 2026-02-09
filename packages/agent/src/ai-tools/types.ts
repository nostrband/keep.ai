import { JSONSchema } from "../json-schema";

export interface AITool<INPUT = any, OUTPUT = any> {
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  execute: (input: INPUT) => Promise<OUTPUT>;
}
