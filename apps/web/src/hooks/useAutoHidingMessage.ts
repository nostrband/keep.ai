import { useState, useRef, useEffect, useCallback } from "react";

interface UseAutoHidingMessageOptions {
  /** Duration in milliseconds before message auto-clears (default: 3000) */
  duration?: number;
}

interface UseAutoHidingMessageReturn {
  /** Current message (empty string if no message) */
  message: string;
  /** Show a message that will auto-hide after duration */
  show: (message: string) => void;
  /** Manually clear the message */
  clear: () => void;
}

/**
 * Hook for managing auto-hiding messages (success notifications, warnings, etc.)
 *
 * Handles:
 * - State management for the message
 * - Timeout tracking with refs
 * - Cleanup on unmount
 * - Resetting timeout when new message shown
 *
 * @example
 * const success = useAutoHidingMessage({ duration: 3000 });
 * const warning = useAutoHidingMessage({ duration: 5000 });
 *
 * // Usage:
 * success.show("Task completed!");
 * warning.show("Something went wrong");
 *
 * // In JSX:
 * {success.message && <div className="text-green-600">{success.message}</div>}
 * {warning.message && <div className="text-yellow-600">{warning.message}</div>}
 */
export function useAutoHidingMessage(
  options: UseAutoHidingMessageOptions = {}
): UseAutoHidingMessageReturn {
  const { duration = 3000 } = options;
  const [message, setMessage] = useState<string>("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setMessage("");
  }, []);

  const show = useCallback((newMessage: string) => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setMessage(newMessage);

    // Set new timeout for auto-clear
    timeoutRef.current = setTimeout(() => {
      setMessage("");
      timeoutRef.current = null;
    }, duration);
  }, [duration]);

  return { message, show, clear };
}
