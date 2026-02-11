import { useAgentStatus, formatAgentStatus } from "../hooks/useAgentStatus";
import { useNeedAuth } from "../hooks/useNeedAuth";

/**
 * A compact badge showing the current agent activity status.
 * Displays in the header showing if tasks or workflows are running,
 * idle, or offline (server unreachable).
 */
export function AgentStatusBadge() {
  const { data: status, isLoading } = useAgentStatus();
  const { isServerError, isLoaded: isAuthLoaded, refresh } = useNeedAuth();

  // Don't show anything while loading initial state
  if (isLoading && !status && !isAuthLoaded) {
    return null;
  }

  // Offline state takes priority - mutually exclusive with idle/running
  if (isServerError) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-600 cursor-pointer"
        title="Server is unreachable. Click to retry."
        onClick={refresh}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        <span className="hidden sm:inline">Offline</span>
      </div>
    );
  }

  const isRunning = status?.isRunning ?? false;
  const statusText = formatAgentStatus(status);

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
        isRunning
          ? "bg-green-100 text-green-700"
          : "bg-gray-100 text-gray-500"
      }`}
      title={statusText}
    >
      {/* Activity indicator dot */}
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"
        }`}
      />
      <span className="hidden sm:inline">{statusText}</span>
    </div>
  );
}
