import { useAgentStatus, formatAgentStatus } from "../hooks/useAgentStatus";

/**
 * A compact badge showing the current agent activity status.
 * Displays in the header showing if tasks or workflows are running.
 */
export function AgentStatusBadge() {
  const { data: status, isLoading, isError } = useAgentStatus();

  // Don't show anything while loading initial state or when server is down
  if ((isLoading && !status) || isError) {
    return null;
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
