# Spec: Align test schemas with production constraints

## Problem
The manually created test schemas in script-store.test.ts and task-store.test.ts use simpler `DEFAULT ''` patterns without the `NOT NULL` constraints that exist in the actual database migrations (v6, v15, v31, etc.). This means tests could pass with NULL values that would fail in production.

## Solution
Update the `createScriptTables()` and `createTaskTables()` helper functions in the test files to include the same NOT NULL constraints as the production migrations.

## Expected Outcome
- Test schemas match production schema constraints
- Tests fail if code inadvertently allows NULL values where production would reject them
- Better confidence that tested code will work correctly in production

## Considerations
- Review the actual migration files to ensure test schemas stay in sync
- Consider extracting shared schema definitions to avoid drift
