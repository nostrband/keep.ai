/**
 * Reconciliation Registry (exec-18)
 *
 * Maintains a registry of reconcile methods for mutation tools.
 * Each connector can register reconcile methods for its mutation operations.
 */

import type { ReconcilableTool, ReconcileMethod, MutationParams } from "./types";
import type { ReconcileResult } from "@app/db";
import debug from "debug";

const log = debug("reconciliation:registry");

/**
 * Singleton registry for reconcilable tools.
 *
 * Connectors register their reconcile methods during initialization.
 * The reconciliation system queries this registry to find the appropriate
 * reconcile method for a given mutation.
 */
class ReconciliationRegistryImpl {
  private tools: Map<string, ReconcilableTool> = new Map();

  /**
   * Generate a unique key for a tool.
   */
  private getKey(namespace: string, method: string): string {
    return `${namespace}:${method}`;
  }

  /**
   * Register a reconcilable tool.
   *
   * @param tool - The tool with its reconcile method
   */
  register(tool: ReconcilableTool): void {
    const key = this.getKey(tool.namespace, tool.method);
    if (this.tools.has(key)) {
      log(`Warning: Overwriting reconcile method for ${key}`);
    }
    this.tools.set(key, tool);
    log(`Registered reconcile method for ${key}`);
  }

  /**
   * Unregister a tool (useful for testing).
   */
  unregister(namespace: string, method: string): boolean {
    const key = this.getKey(namespace, method);
    return this.tools.delete(key);
  }

  /**
   * Get the reconcile method for a tool.
   *
   * @param namespace - Tool namespace (e.g., "Gmail")
   * @param method - Tool method (e.g., "send")
   * @returns The reconcile method, or undefined if not registered
   */
  getReconcileMethod(namespace: string, method: string): ReconcileMethod | undefined {
    const key = this.getKey(namespace, method);
    return this.tools.get(key)?.reconcile;
  }

  /**
   * Check if a tool has a reconcile method registered.
   */
  hasReconcileMethod(namespace: string, method: string): boolean {
    const key = this.getKey(namespace, method);
    return this.tools.has(key);
  }

  /**
   * Attempt reconciliation for a mutation.
   *
   * @param params - Mutation parameters
   * @returns ReconcileResult or null if no reconcile method registered
   */
  async reconcile(params: MutationParams): Promise<ReconcileResult | null> {
    const reconcileMethod = this.getReconcileMethod(
      params.toolNamespace,
      params.toolMethod
    );

    if (!reconcileMethod) {
      log(`No reconcile method for ${params.toolNamespace}:${params.toolMethod}`);
      return null;
    }

    log(`Attempting reconciliation for ${params.toolNamespace}:${params.toolMethod}`);
    try {
      const result = await reconcileMethod(params);
      log(`Reconciliation result for ${params.toolNamespace}:${params.toolMethod}: ${result.status}`);
      return result;
    } catch (error) {
      log(`Reconciliation error for ${params.toolNamespace}:${params.toolMethod}: ${error}`);
      // Reconciliation call failed - treat as retry needed
      return { status: "retry" };
    }
  }

  /**
   * Get all registered tools (for debugging/testing).
   */
  getRegisteredTools(): Array<{ namespace: string; method: string }> {
    return Array.from(this.tools.values()).map((tool) => ({
      namespace: tool.namespace,
      method: tool.method,
    }));
  }

  /**
   * Clear all registrations (useful for testing).
   */
  clear(): void {
    this.tools.clear();
    log("Cleared all reconcile registrations");
  }
}

/**
 * Singleton instance of the reconciliation registry.
 */
export const ReconciliationRegistry = new ReconciliationRegistryImpl();
