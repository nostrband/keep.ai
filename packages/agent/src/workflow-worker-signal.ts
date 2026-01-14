/**
 * Signals sent from WorkflowWorker to WorkflowScheduler to communicate
 * execution outcomes that affect scheduling decisions.
 */
export interface WorkflowExecutionSignal {
  type: 'retry' | 'payment_required' | 'done';
  workflowId: string;
  timestamp: number;
  error?: string;              // Error message for logging
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
