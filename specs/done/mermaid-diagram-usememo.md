# Spec: Memoize mermaid diagram markdown string

## Problem

In WorkflowDetailPage, the mermaid diagram is rendered using a template literal that creates a new string on each render:

```typescript
<Response>{`\`\`\`mermaid\n${latestScript.diagram}\n\`\`\``}</Response>
```

The Response component uses React.memo with reference equality (`prevProps.children === nextProps.children`), but since the template literal creates a new string each time, the memoization is ineffective and causes unnecessary re-renders.

## Solution

Wrap the markdown string in useMemo to maintain referential stability:

```typescript
const diagramMarkdown = useMemo(
  () => `\`\`\`mermaid\n${latestScript?.diagram}\n\`\`\``,
  [latestScript?.diagram]
);
```

## Expected Outcome

- Response component's memo works as intended
- Mermaid diagram only re-renders when the actual diagram content changes
- Reduced unnecessary re-renders when parent component updates

## Considerations

- Minor performance optimization - impact is small but fix is trivial
- Same pattern may apply to other places using Response with dynamic content
