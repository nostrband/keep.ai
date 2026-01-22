# Spec: Fix retry navigation link to handle script changes

## Problem

In ScriptRunDetailPage, the "Retry of Run" link constructs the URL using the current run's `script_id`:

```
/scripts/${run.script_id}/runs/${run.retry_of}
```

If the script changed between the original run and the retry (e.g., due to maintenance mode creating a new script version), this link may point to a non-existent or incorrect page since the original run may have used a different script_id.

## Solution

Query the original run to get its actual script_id rather than assuming it matches the current run's script_id. Use that script_id when constructing the navigation link.

## Expected Outcome

- "Retry of Run" link correctly navigates to the original run regardless of script changes
- Works correctly even when maintenance mode has created new script versions between retries

## Considerations

- May need to fetch additional data (the original run's script_id) or include it in the retry tracking
- Alternative: store original script_id in the retry record itself
- Consider if the URL structure `/scripts/{id}/runs/{runId}` is the right pattern, or if runs should be addressable independently of scripts
