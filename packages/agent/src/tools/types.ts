import { z } from "zod";

/**
 * Tool definition for sandbox-executable tools.
 * This is the internal interface used by ToolWrapper to track tools
 * and enforce mutation restrictions via isReadOnly metadata.
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  /** Tool namespace (e.g., "Gmail", "Memory", "Files") */
  namespace: string;

  /** Tool name within namespace (e.g., "api", "getNote", "read") */
  name: string;

  /** Human-readable description for documentation */
  description: string;

  /** Zod schema for input validation */
  inputSchema: z.ZodType<TInput>;

  /** Optional Zod schema for output validation */
  outputSchema?: z.ZodType<TOutput>;

  /** Execute the tool with validated input */
  execute: (input: TInput) => Promise<TOutput>;

  /**
   * Determine if a tool call with given params is read-only.
   * If absent, all calls are assumed to be mutations (writes).
   * Used by withItem to enforce mutation restrictions.
   */
  isReadOnly?: (params: TInput) => boolean;
}

/**
 * Tool that is always read-only (no mutations).
 * The isReadOnly field is set to a constant function returning true.
 */
export type ReadOnlyTool<TInput = unknown, TOutput = unknown> = Tool<TInput, TOutput> & {
  isReadOnly: () => true;
};

/**
 * Helper to create a tool definition with full metadata.
 */
export function defineTool<TInput, TOutput>(
  config: Tool<TInput, TOutput>
): Tool<TInput, TOutput> {
  return config;
}

/**
 * Helper to create a read-only tool definition.
 * Sets isReadOnly to always return true.
 */
export function defineReadOnlyTool<TInput, TOutput>(
  config: Omit<Tool<TInput, TOutput>, 'isReadOnly'>
): Tool<TInput, TOutput> {
  return { ...config, isReadOnly: () => true };
}

/**
 * Item status for the logical items system.
 */
export type ItemStatus = 'processing' | 'done' | 'failed' | 'skipped';

/**
 * Who created the item (for tracking purposes).
 */
export type ItemCreatedBy = 'workflow' | 'planner' | 'maintainer';

/**
 * Context passed to withItem handler.
 */
export interface ItemContext {
  item: {
    /** The logical item ID */
    id: string;
    /** Human-readable title */
    title: string;
    /** Whether this item was already completed */
    isDone: boolean;
  };
}
