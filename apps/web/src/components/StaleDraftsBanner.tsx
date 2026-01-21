import { useDraftActivitySummary } from "../hooks/dbScriptReads";
import { Clock, AlertTriangle, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Banner that shows when there are stale or abandoned draft workflows.
 * Appears on the MainPage to prompt users to continue or archive incomplete drafts.
 *
 * Design follows the spec 13b:
 * - Stale drafts (3-7 days): Subtle indicator
 * - Abandoned drafts (7+ days): Prompt user to continue or archive
 * - Waiting for input: Show prominently
 */
export function StaleDraftsBanner() {
  const { data: summary, isLoading } = useDraftActivitySummary();

  // Don't show if loading or no drafts needing attention
  if (isLoading || !summary) return null;

  const { abandonedDrafts, waitingForInput, totalDrafts } = summary;

  // No banner needed if nothing needs attention
  if (abandonedDrafts === 0 && waitingForInput === 0) return null;

  // Compose the message parts
  const messageParts: string[] = [];
  if (waitingForInput > 0) {
    messageParts.push(
      `${waitingForInput} draft${waitingForInput === 1 ? " is" : "s are"} waiting for your input`
    );
  }
  if (abandonedDrafts > 0) {
    messageParts.push(
      `${abandonedDrafts} draft${abandonedDrafts === 1 ? " has" : "s have"} been inactive for 7+ days`
    );
  }

  // Determine banner style based on priority
  // Waiting for input is more urgent than just being stale
  const isUrgent = waitingForInput > 0;

  return (
    <Link
      to="/workflows?filter=drafts"
      className={`w-full mb-6 p-3 rounded-lg border flex items-center gap-2 transition-colors ${
        isUrgent
          ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
          : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
      }`}
    >
      {isUrgent ? (
        <MessageCircle className="h-5 w-5 flex-shrink-0" />
      ) : (
        <Clock className="h-5 w-5 flex-shrink-0" />
      )}
      <span className="font-medium">
        {messageParts.join(" • ")}
      </span>
      <span className="ml-auto text-sm opacity-75">
        View drafts
      </span>
    </Link>
  );
}
