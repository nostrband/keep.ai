/**
 * Workflow Script Validation (exec-05).
 *
 * Validates workflow script structure on save/fix. Extracts handler config
 * and rejects malformed scripts immediately so LLM can fix them.
 *
 * See specs/exec-05-script-validation.md for design details.
 */

import { initSandbox, Sandbox } from "./sandbox/sandbox";

// ============================================================================
// Types
// ============================================================================

/**
 * Extracted workflow configuration from a validated script.
 * Stored in workflow.handler_config as JSON.
 */
export interface WorkflowConfig {
  topics: string[];
  producers: Record<
    string,
    {
      schedule: { interval?: string; cron?: string };
    }
  >;
  consumers: Record<
    string,
    {
      subscribe: string[];
      hasMutate: boolean;
      hasNext: boolean;
    }
  >;
}

/**
 * Result of workflow script validation.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  config?: WorkflowConfig;
}

// ============================================================================
// Tool Namespaces
// ============================================================================

/**
 * List of tool namespaces that need stub proxies during validation.
 * These are all the namespaces that workflow scripts might reference.
 */
const TOOL_NAMESPACES = [
  // Core tools
  "Console",
  "Files",
  "Memory",
  "Scripts",
  "User",
  "Util",
  // External services
  "Gmail",
  "GoogleDocs",
  "GoogleDrive",
  "GoogleSheets",
  "Notion",
  "Web",
  "Weather",
  // Media processing
  "Audio",
  "Images",
  "Pdf",
  "Text",
  // Execution model
  "Topics",
  "Items", // Deprecated but may exist in old scripts
];

// ============================================================================
// Validation Sandbox
// ============================================================================

/**
 * Create a sandbox for validation with all tool namespaces stubbed.
 * Tool calls during validation throw an error.
 */
async function createValidationSandbox(): Promise<Sandbox> {
  const sandbox = await initSandbox({ timeoutMs: 5000 });

  // Create a proxy that throws for any property access
  const createStubNamespace = () =>
    new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === Symbol.toStringTag) return "Object";
          // Return a function that throws when called
          return () => {
            throw new Error(
              `Tool calls not allowed during validation: ${String(prop)}`
            );
          };
        },
      }
    );

  // Inject stub namespaces for all tools
  const globals: Record<string, unknown> = {};
  for (const namespace of TOOL_NAMESPACES) {
    globals[namespace] = createStubNamespace();
  }

  // Add getDocs stub
  globals["getDocs"] = () => {
    throw new Error("getDocs not allowed during validation");
  };

  sandbox.setGlobal(globals);

  return sandbox;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validation code to inject after user script.
 * Validates structure and extracts configuration.
 */
const VALIDATION_CODE = `
// Structure validation
if (typeof workflow !== 'object' || workflow === null) {
  throw new Error('Script must define a workflow object');
}

if (!workflow.producers && !workflow.consumers) {
  throw new Error('Workflow must have at least one producer or consumer');
}

// Validate producers
const producerConfig = {};
for (const [name, p] of Object.entries(workflow.producers || {})) {
  if (typeof p.handler !== 'function') {
    throw new Error(\`Producer '\${name}': handler must be a function\`);
  }
  if (!p.schedule || (!p.schedule.interval && !p.schedule.cron)) {
    throw new Error(\`Producer '\${name}': schedule with interval or cron required\`);
  }
  producerConfig[name] = { schedule: p.schedule };
}

// Validate consumers
const consumerConfig = {};
for (const [name, c] of Object.entries(workflow.consumers || {})) {
  if (!Array.isArray(c.subscribe) || c.subscribe.length === 0) {
    throw new Error(\`Consumer '\${name}': subscribe must be non-empty array\`);
  }
  if (typeof c.prepare !== 'function') {
    throw new Error(\`Consumer '\${name}': prepare must be a function\`);
  }
  if (c.mutate !== undefined && typeof c.mutate !== 'function') {
    throw new Error(\`Consumer '\${name}': mutate must be a function if provided\`);
  }
  if (c.next !== undefined && typeof c.next !== 'function') {
    throw new Error(\`Consumer '\${name}': next must be a function if provided\`);
  }
  consumerConfig[name] = {
    subscribe: c.subscribe,
    hasMutate: typeof c.mutate === 'function',
    hasNext: typeof c.next === 'function',
  };
}

// Return extracted config
return {
  topics: Object.keys(workflow.topics || {}),
  producers: producerConfig,
  consumers: consumerConfig,
};
`;

/**
 * Validate a workflow script and extract its configuration.
 *
 * The script must define a `workflow` object with:
 * - Optional `topics` object (key = topic name)
 * - Optional `producers` object with handler functions and schedules
 * - Optional `consumers` object with prepare, mutate, and next functions
 *
 * At least one producer or consumer must exist.
 *
 * @param code - The workflow script code to validate
 * @returns Validation result with extracted config if valid
 */
export async function validateWorkflowScript(
  code: string
): Promise<ValidationResult> {
  let sandbox: Sandbox | undefined;

  try {
    sandbox = await createValidationSandbox();

    // Combine user code with validation code
    const fullCode = `${code}\n\n${VALIDATION_CODE}`;

    const result = await sandbox.eval(fullCode, { timeoutMs: 5000 });

    if (result.ok) {
      const config = result.result as WorkflowConfig;
      return { valid: true, config };
    } else {
      // Extract meaningful error message
      const errorMessage = extractErrorMessage(result.error);
      return { valid: false, error: errorMessage };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  } finally {
    sandbox?.dispose();
  }
}

/**
 * Extract a clean error message from sandbox error output.
 */
function extractErrorMessage(error: string): string {
  // QuickJS errors often have format: "Error: 'message' stack:\n..."
  // Extract just the message part
  const match = error.match(/Error:\s*'([^']+)'/);
  if (match) {
    return match[1];
  }

  // Try to extract from simpler format: "Error: message"
  const simpleMatch = error.match(/Error:\s*(.+?)(?:\s+stack:|$)/);
  if (simpleMatch) {
    return simpleMatch[1].trim();
  }

  return error;
}

/**
 * Check if a script uses the new workflow format.
 * Scripts that define a `workflow` object are new-format scripts.
 * Old-format scripts just have inline code.
 *
 * This is a quick heuristic check - not a full parse.
 *
 * @param code - The script code to check
 * @returns true if the script appears to use the new workflow format
 */
export function isWorkflowFormatScript(code: string): boolean {
  // Look for "const workflow" or "let workflow" or "var workflow"
  // followed by an object literal
  return /(?:const|let|var)\s+workflow\s*=\s*\{/.test(code);
}
