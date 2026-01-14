/**
 * Signals sent from TaskWorker to TaskScheduler to communicate
 * execution outcomes that affect scheduling decisions.
 */
export interface TaskExecutionSignal {
  type: 'retry' | 'payment_required' | 'done';
  taskId: string;
  timestamp: number;
  error?: string;              // Error message for logging
}

/**
 * Callback function type for handling task execution signals
 */
export type TaskSignalHandler = (signal: TaskExecutionSignal) => void;

/**
 * Retry state for a specific task
 */
export interface TaskRetryState {
  nextStart: number; // timestamp in milliseconds when task can be retried
  retryCount: number; // number of retry attempts
}
