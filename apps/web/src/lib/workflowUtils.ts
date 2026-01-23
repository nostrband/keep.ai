/**
 * Default title for workflows without a title set.
 */
export const DEFAULT_WORKFLOW_TITLE = "New workflow";

/**
 * Get the display title for a workflow.
 * Returns the workflow's title if set, otherwise returns the default title.
 */
export function getWorkflowTitle(workflow: { title?: string | null }): string {
  return workflow.title || DEFAULT_WORKFLOW_TITLE;
}

/**
 * Determine if a script run is currently running (has started but not ended).
 */
export function isScriptRunRunning(run: { end_timestamp?: string | null } | null | undefined): boolean {
  return run != null && !run.end_timestamp;
}
