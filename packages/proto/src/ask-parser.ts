// TODO v2: Structured asks are disabled for v1. LLM asks in plain text.
// This parser is kept for potential v2 use and backward compat with existing data.

/**
 * Structured ask format stored in task state.
 * Used by the UI to display quick-reply buttons.
 */
export interface StructuredAsk {
  question: string;
  options?: string[];
}

/**
 * Parse the asks field from task state.
 * Returns structured format if it's JSON, otherwise wraps the string.
 */
export function parseAsks(asks: string): StructuredAsk {
  if (!asks) {
    return { question: "" };
  }

  try {
    const parsed = JSON.parse(asks);
    if (typeof parsed === "object" && parsed.question) {
      return {
        question: parsed.question,
        options: Array.isArray(parsed.options) ? parsed.options : undefined,
      };
    }
  } catch {
    // Not JSON, use as plain string
  }

  return { question: asks };
}
