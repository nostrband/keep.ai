# exec-02: Deprecate Items Infrastructure

## Goal

Remove the old "logical items" infrastructure (`Items.withItem`, `Items.list`, `ItemStore`) which is being replaced by the event-driven execution model.

## What to Remove

### Database

- Mark `items` table as deprecated (add comment in migration)
- Do NOT drop the table yet (keep for data preservation)

### Store Layer

- Remove or deprecate `ItemStore` class (`packages/db/src/item-store.ts`)
- Remove `itemStore` from `KeepDbApi` class

### Sandbox API

Remove from `packages/agent/src/sandbox/api.ts`:

1. **`Items.withItem()` function**
   - Remove `createWithItemFunction()` method
   - Remove from `createGlobal()` injection

2. **`Items.list` tool**
   - Remove tool definition from `packages/agent/src/tools/items-list.ts`
   - Remove from tool registry

3. **`activeItem` tracking**
   - Remove `activeItem` property
   - Remove `activeItemIsDone` property
   - Remove related state management

4. **`enforceMutationRestrictions()` method**
   - Remove the method entirely (will be replaced by phase enforcement in exec-04)

### Prompts

Update prompts in `packages/agent/src/agent-env.ts`:

1. **Planner prompt**
   - Remove "Logical Items" section
   - Remove `Items.withItem()` examples and rules

2. **Maintainer prompt**
   - Remove "Logical Item Constraints" section

### Tests

- Remove or skip `packages/tests/src/logical-items.test.ts`
- Remove Items-related test utilities

## Implementation Order

1. Remove `Items.list` tool from registry
2. Remove `Items.withItem()` from SandboxAPI
3. Remove `activeItem` tracking and `enforceMutationRestrictions()`
4. Update planner/maintainer prompts
5. Deprecate `ItemStore` (can keep class but mark deprecated)
6. Update/remove tests

## Notes

- This is a breaking change for existing workflows using `Items.withItem()`
- Existing workflows will need to be re-planned with new format
- The `items` table data is preserved for reference but no longer used

## Testing

- Verify sandbox runs without Items API
- Verify prompts don't reference Items
- Verify old workflow scripts fail gracefully (validation error, not crash)
