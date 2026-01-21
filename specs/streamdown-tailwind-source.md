# Spec: Add Streamdown to Tailwind CSS sources

## Problem

Streamdown documentation requires adding its distribution files to Tailwind's content sources for proper CSS class inclusion. Currently, tailwind.config.js only scans local source files, which may cause Streamdown's mermaid diagram styles to be missing from production CSS builds.

## Solution

Update the Tailwind configuration to include Streamdown's distribution files in the content sources.

## Expected Outcome

- Mermaid diagrams rendered via Streamdown display correctly in production builds
- All Streamdown-specific CSS classes are included in the final CSS bundle

## Considerations

- Verify mermaid rendering works correctly after the change
- Check if other Streamdown features (beyond mermaid) also require this fix
