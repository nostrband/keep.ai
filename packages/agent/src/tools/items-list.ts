/**
 * @deprecated This tool is part of the deprecated Items infrastructure (exec-02).
 * Use the new Topics-based event-driven execution model instead.
 * See specs/exec-02-deprecate-items.md for details.
 */
import { z } from "zod";
import { defineReadOnlyTool, Tool } from "./types";
import { ItemStore, ItemStatus } from "@app/db";

const ItemStatusEnum = z.enum(['processing', 'done', 'failed', 'skipped']);

const ItemSchema = z.object({
  id: z.string(),
  logical_item_id: z.string(),
  title: z.string(),
  status: ItemStatusEnum,
  current_attempt_id: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
});

const inputSchema = z.object({
  status: ItemStatusEnum.optional().describe(
    "Filter by item status: 'processing', 'done', 'failed', 'skipped'"
  ),
  logical_item_id: z.string().optional().describe(
    "Filter by exact logical item ID (useful to check if specific item exists)"
  ),
  limit: z.number().min(1).max(1000).optional().describe(
    "Maximum number of items to return (default: 100, max: 1000)"
  ),
  offset: z.number().min(0).optional().describe(
    "Number of items to skip for pagination (default: 0)"
  ),
});

const outputSchema = z.object({
  items: z.array(ItemSchema),
  total: z.number().describe("Total count matching the filter (for pagination)"),
  has_more: z.boolean().describe("Whether there are more items beyond this page"),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/**
 * Create the Items.list tool for introspecting processed items.
 *
 * This allows scripts to check which items have been processed, failed, or are pending.
 * Useful for resuming work or understanding progress through a dataset.
 */
export function makeItemsListTool(
  itemStore: ItemStore,
  getWorkflowId: () => string | undefined
): Tool<Input, Output> {
  return defineReadOnlyTool({
    namespace: "Items",
    name: "list",
    description: `List logical items for the current workflow with optional filtering and pagination.
Use this to check which items have been processed, failed, or are pending.
Useful for resuming work or understanding progress through a dataset.

Example: Check if an item was already processed:
  const items = await Items.list({ logical_item_id: 'email:abc123' });
  const alreadyDone = items.items.some(i => i.status === 'done');

Example: Get all failed items for retry logic:
  const failed = await Items.list({ status: 'failed', limit: 100 });

Example: Paginate through all done items:
  let offset = 0;
  while (true) {
    const page = await Items.list({ status: 'done', limit: 50, offset });
    if (page.items.length === 0) break;
    // process page.items
    offset += page.items.length;
  }

ℹ️ Not a mutation - can be used outside Items.withItem().`,
    inputSchema,
    outputSchema,
    execute: async (input: Input): Promise<Output> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        throw new Error("Items.list requires a workflow context");
      }

      const { status, logical_item_id } = input;
      // Apply defaults for pagination
      const limit = input.limit ?? 100;
      const offset = input.offset ?? 0;

      // If filtering by specific logical_item_id, use getItem
      if (logical_item_id) {
        const item = await itemStore.getItem(workflowId, logical_item_id);
        if (!item) {
          return { items: [], total: 0, has_more: false };
        }
        // Apply status filter if provided
        if (status && item.status !== status) {
          return { items: [], total: 0, has_more: false };
        }
        return {
          items: [{
            id: item.id,
            logical_item_id: item.logical_item_id,
            title: item.title,
            status: item.status,
            current_attempt_id: item.current_attempt_id,
            created_at: item.created_at,
            updated_at: item.updated_at,
          }],
          total: 1,
          has_more: false,
        };
      }

      // Get items with pagination (fetch one extra to check has_more)
      const items = await itemStore.listItems(workflowId, {
        status: status as ItemStatus | undefined,
        limit: limit + 1,
        offset,
      });

      const has_more = items.length > limit;
      const resultItems = has_more ? items.slice(0, limit) : items;

      // Get total count for pagination info
      const counts = await itemStore.countByStatus(workflowId);
      const total = status
        ? counts[status as ItemStatus]
        : Object.values(counts).reduce((a, b) => a + b, 0);

      return {
        items: resultItems.map(item => ({
          id: item.id,
          logical_item_id: item.logical_item_id,
          title: item.title,
          status: item.status,
          current_attempt_id: item.current_attempt_id,
          created_at: item.created_at,
          updated_at: item.updated_at,
        })),
        total,
        has_more,
      };
    },
  }) as Tool<Input, Output>;
}
