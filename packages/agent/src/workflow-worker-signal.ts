import { ErrorType } from "./errors";

/**
 * Signals used by WorkflowScheduler to communicate
 * execution outcomes that affect scheduling decisions.
 *
 * Signal types:
 * - 'done': Workflow completed successfully or failed without retry
 * - 'retry': Workflow should be retried (network errors, transient failures)
 * - 'payment_required': Global pause needed (LLM API quota/payment issue)
 * - 'needs_attention': Workflow requires user action (auth/permission errors)
 * - 'maintenance': Workflow entered maintenance mode for agent auto-fix (logic errors)
 */
export interface WorkflowExecutionSignal {
  type: 'retry' | 'payment_required' | 'done' | 'needs_attention' | 'maintenance';
  workflowId: string;
  timestamp: number;
  error?: string;              // Error message for logging
  errorType?: ErrorType;       // Classified error type (auth, permission, network, logic)
  scriptRunId?: string;        // ID of the script run that triggered this signal
}

/**
 * Retry state for a specific workflow
 */
export interface WorkflowRetryState {
  nextStart: number;      // timestamp in milliseconds when workflow can be retried
  retryCount: number;     // number of retry attempts
  originalRunId: string;  // ID of the original failed script run (for retry chain tracking)
}
