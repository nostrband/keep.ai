# Spec: Fix maintainerTasks Type Safety

## Problem

In `WorkflowDetailPage.tsx`, the maintainerTasks map callback uses `any` type:

```typescript
{maintainerTasks.map((task: any) => (
```

This loses type safety and IDE support for task properties.

## Solution

Import and use the `Task` type from @app/db:

```typescript
import { Task } from "@app/db";
// ...
{maintainerTasks.map((task: Task) => (
```

## Expected Outcome

- Full type safety for task properties
- IDE autocomplete and error checking
- Compile-time detection of property access errors
