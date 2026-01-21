# Spec: Reuse Markdown Component for Mermaid Diagrams

## Problem
The MermaidDiagram component uses a separate `mermaid` package directly with security concerns (securityLevel: "loose", dangerouslySetInnerHTML without sanitization). Meanwhile, the chat message display already has markdown rendering with Mermaid support via the streamdown package.

## Solution
Remove the dedicated MermaidDiagram component and mermaid package. Instead, wrap the diagram source in a markdown code fence and render using the existing markdown display component used for chat messages.

## Expected Outcome
- MermaidDiagram component removed
- Direct mermaid package dependency removed
- Workflow detail page uses the same markdown component as chat for diagram rendering
- Consistent and secure Mermaid rendering across the app
- Reduced bundle size and maintenance burden
