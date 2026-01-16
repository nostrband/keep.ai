import { ErrorType } from "./errors";

/**
 * Signals sent from WorkflowWorker to WorkflowScheduler to communicate
 * execution outcomes that affect scheduling decisions.
 *
 * Signal types:
 * - 'done': Workflow completed successfully or failed without retry
 * - 'retry': Workflow should be retried (network errors, logic errors pending auto-fix)
 * - 'payment_required': Global pause needed (LLM API quota/payment issue)
 * - 'needs_attention': Workflow requires user action (auth/permission errors)
 */
export interface WorkflowExecutionSignal {
  type: 'retry' | 'payment_required' | 'done' | 'needs_attention';
  workflowId: string;
  timestamp: number;
  error?: string;              // Error message for logging
  errorType?: ErrorType;       // Classified error type (auth, permission, network, logic)
}

/**
 * Callback function type for handling workflow execution signals
 */
export type WorkflowSignalHandler = (signal: WorkflowExecutionSignal) => void;

/**
 * Retry state for a specific workflow
 */
export interface WorkflowRetryState {
  nextStart: number; // timestamp in milliseconds when workflow can be retried
  retryCount: number; // number of retry attempts
}
