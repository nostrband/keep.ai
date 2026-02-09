import Ajv from "ajv";
import addFormats from "ajv-formats";

/**
 * Minimal typed subset of JSON Schema covering our usage.
 */
export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: any[];
  anyOf?: JSONSchema[];
  description?: string;
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
  nullable?: boolean;
  additionalProperties?: boolean | JSONSchema;
}

// Singleton ajv instance with defaults + formats
const ajv = new Ajv({ useDefaults: true, allErrors: true });
addFormats(ajv as any);

// Cache compiled validators keyed by schema reference
const validatorCache = new WeakMap<JSONSchema, ReturnType<typeof ajv.compile>>();

/**
 * Validate a value against a JSON Schema.
 * Applies defaults during validation via ajv's useDefaults option.
 * Returns the (potentially mutated) value with defaults filled in.
 */
export function validateJsonSchema(
  schema: JSONSchema,
  value: unknown
): { valid: boolean; errors: string[]; value: unknown } {
  let validate = validatorCache.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validatorCache.set(schema, validate);
  }

  // ajv mutates value in-place to apply defaults
  const valid = validate(value);
  if (valid) {
    return { valid: true, errors: [], value };
  }

  const errors = (validate.errors || []).map(
    (e: any) => `${e.instancePath || e.dataPath || "/"} ${e.message || "unknown error"}`
  );
  return { valid: false, errors, value };
}

/**
 * Print a JSON Schema as human-readable documentation.
 * Replaces the old Zod-internal-walking printSchema.
 */
export function printJsonSchema(schema: JSONSchema): string {
  // Primitive with description — use angle bracket form
  const isPrimitive =
    schema.type === "string" ||
    schema.type === "number" ||
    schema.type === "integer" ||
    schema.type === "boolean";

  if (schema.description && isPrimitive && !schema.enum) {
    return `<${schema.description}>`;
  }

  // enum
  if (schema.enum) {
    const result = `enum(${schema.enum.join(", ")})`;
    if (schema.description) return `${result} /* ${schema.description} */`;
    return result;
  }

  // anyOf (union)
  if (schema.anyOf) {
    const result = schema.anyOf.map(printJsonSchema).join(" | ");
    if (schema.description) return `${result} /* ${schema.description} */`;
    return result;
  }

  // array
  if (schema.type === "array") {
    const inner = schema.items ? printJsonSchema(schema.items) : "any";
    const result = `[${inner}]`;
    if (schema.description) return `${result} /* ${schema.description} */`;
    return result;
  }

  // object
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required || []);
    const body = Object.entries(schema.properties)
      .map(([key, prop]) => {
        const opt = required.has(key) ? "" : "?";
        const def = prop.default !== undefined ? " (default)" : "";
        return `${key}${opt}: ${printJsonSchema(prop)}${def}`;
      })
      .join("; ");
    const result = `{ ${body} }`;
    if (schema.description) return `${result} /* ${schema.description} */`;
    return result;
  }

  // simple types
  if (schema.type === "string") return "string";
  if (schema.type === "number") return "number";
  if (schema.type === "integer") return "number";
  if (schema.type === "boolean") return "boolean";

  // nullable wrapper
  if (schema.nullable) {
    const inner = { ...schema, nullable: undefined };
    return `${printJsonSchema(inner)} | null`;
  }

  // no type constraint (z.any() equivalent)
  if (!schema.type && !schema.anyOf && !schema.enum) {
    if (schema.description) return `<${schema.description}>`;
    return "any";
  }

  return "any";
}
