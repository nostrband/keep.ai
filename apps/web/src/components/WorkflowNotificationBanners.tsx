import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../ui";
import { Notification } from "packages/db/dist";
import { useResolveNotification, useResumeWorkflows } from "../hooks/useNotifications";
import { useConnections } from "../hooks/dbConnectionReads";
import { useDbQuery } from "../hooks/dbQuery";
import { ChevronDown, ChevronRight, X, CheckCircle } from "lucide-react";

const ACTIONABLE_TYPES = new Set(["error", "escalated", "maintenance_failed"]);

interface ErrorPayload {
  error_type?: string;
  service?: string;
  account?: string;
  message?: string;
}

interface MaintenanceFailedPayload {
  explanation?: string;
}

interface EscalatedPayload {
  fix_attempts?: number;
  reason?: string;
}

function parsePayload<T>(payload: string): T | null {
  if (!payload) return null;
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function getRelativeTime(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

interface WorkflowNotificationBannersProps {
  notifications: Notification[];
  workflowId: string;
}

/**
 * Renders notification banners on the workflow detail page.
 * - Actionable types (error, escalated, maintenance_failed) get collapsible inline banners.
 * - Informational types (script_message, script_ask) get a summary count linking to the notifications page.
 */
export function WorkflowNotificationBanners({ notifications, workflowId }: WorkflowNotificationBannersProps) {
  const actionable = notifications.filter((n) => ACTIONABLE_TYPES.has(n.type));
  const informational = notifications.filter((n) => !ACTIONABLE_TYPES.has(n.type));

  if (actionable.length === 0 && informational.length === 0) return null;

  return (
    <div className="space-y-3 mb-6">
      {actionable.map((n) => (
        <NotificationBanner key={n.id} notification={n} />
      ))}
      {informational.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-blue-800">
              {informational.length} notification{informational.length === 1 ? "" : "s"}
            </span>
            <Link
              to={`/notifications/${workflowId}`}
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationBanner({ notification }: { notification: Notification }) {
  switch (notification.type) {
    case "error":
      return <ErrorBanner notification={notification} />;
    case "escalated":
      return <EscalatedBanner notification={notification} />;
    case "maintenance_failed":
      return <MaintenanceFailedBanner notification={notification} />;
    default:
      return null;
  }
}

function ErrorBanner({ notification }: { notification: Notification }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const resolveMutation = useResolveNotification();
  const resumeMutation = useResumeWorkflows();
  const { data: connections = [] } = useConnections();

  const payload = parsePayload<ErrorPayload>(notification.payload);
  const errorType = payload?.error_type || "internal";
  const service = payload?.service;
  const account = payload?.account;
  const message = payload?.message || "An error occurred";

  // Check if the specific connector instance is now connected
  const isServiceRestored = errorType === "auth" && service &&
    connections.some((c) =>
      c.service === service && c.status === "connected" &&
      (!account || c.accountId === account)
    );

  const errorTypeLabels: Record<string, string> = {
    auth: "Authentication",
    permission: "Permission",
    network: "Network",
    internal: "Internal",
  };

  const handleResume = () => {
    resumeMutation.mutate([{
      workflowId: notification.workflow_id,
      title: notification.workflow_title,
      notificationId: notification.id,
      service: service || "",
    }]);
  };

  const getActionButton = () => {
    if (isServiceRestored) {
      return {
        label: "Resume automation",
        onClick: handleResume,
      };
    }
    switch (errorType) {
      case "auth":
        return {
          label: service
            ? `Reconnect ${service}${account ? ` (${account})` : ""}`
            : "Reconnect",
          onClick: () => navigate("/settings"),
        };
      case "permission":
        return {
          label: "Check Permissions",
          onClick: () => navigate("/settings"),
        };
      case "network":
        return {
          label: "Retry Now",
          onClick: async () => {
            await resolveMutation.mutateAsync(notification.id);
          },
        };
      case "internal":
      default:
        return {
          label: "View Details",
          onClick: () => navigate(`/notifications/${notification.workflow_id}`),
        };
    }
  };

  const actionButton = getActionButton();
  const isPending = resolveMutation.isPending || resumeMutation.isPending;

  if (isServiceRestored) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 cursor-pointer text-left flex-1"
          >
            <CheckCircle className="w-4 h-4 text-green-600" />
            {expanded
              ? <ChevronDown className="w-4 h-4 text-green-400" />
              : <ChevronRight className="w-4 h-4 text-green-400" />
            }
            <span className="font-medium text-green-900">
              Connection restored{account ? ` — ${account}` : ""}
            </span>
            <span className="text-xs text-green-500 ml-2">{getRelativeTime(notification.timestamp)}</span>
          </button>
          <button
            onClick={() => resolveMutation.mutateAsync(notification.id)}
            className="p-1 text-green-300 hover:text-green-500 cursor-pointer rounded hover:bg-green-100"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {expanded && (
          <>
            <p className="text-sm text-green-700 mt-2 ml-7">
              {service}{account ? ` (${account})` : ""} is connected again. Resume this workflow to continue processing.
            </p>
            <div className="mt-3 ml-7 flex gap-2">
              <Button
                size="sm"
                className="cursor-pointer bg-green-600 hover:bg-green-700 text-white"
                onClick={actionButton.onClick}
                disabled={isPending}
              >
                {isPending ? "Resuming..." : actionButton.label}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 cursor-pointer text-left flex-1"
        >
          <span>⚠️</span>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-red-400" />
            : <ChevronRight className="w-4 h-4 text-red-400" />
          }
          <span className="font-medium text-red-900">
            {errorTypeLabels[errorType]} error{errorType === "auth" && account ? ` — ${account}` : ""}
          </span>
          <span className="text-xs text-red-400 ml-2">{getRelativeTime(notification.timestamp)}</span>
        </button>
        <button
          onClick={() => resolveMutation.mutateAsync(notification.id)}
          className="p-1 text-red-300 hover:text-red-500 cursor-pointer rounded hover:bg-red-100"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {expanded && (
        <>
          <p className="text-sm text-red-700 mt-2 ml-7">{message}</p>
          <div className="mt-3 ml-7 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer border-red-300 text-red-700 hover:bg-red-100"
              onClick={actionButton.onClick}
              disabled={isPending}
            >
              {actionButton.label}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function useNavigateToChat(notification: Notification) {
  const navigate = useNavigate();
  const { api } = useDbQuery();

  return async () => {
    if (!api) return;
    try {
      const workflow = await api.scriptStore.getWorkflow(notification.workflow_id);
      if (workflow?.chat_id) {
        const payload = parsePayload<MaintenanceFailedPayload & EscalatedPayload>(notification.payload);
        const seedMessage = notification.type === "maintenance_failed"
          ? `The auto-fix failed: ${payload?.explanation || "unknown reason"}. Let's discuss how to resolve this.`
          : `The automation needs help (AI tried ${payload?.fix_attempts || 3}x). Let's discuss how to fix this.`;
        navigate(`/chats/${workflow.chat_id}?message=${encodeURIComponent(seedMessage)}`);
        return;
      }
    } catch {
      // fall through to workflow page
    }
    navigate(`/workflows/${notification.workflow_id}`);
  };
}

function EscalatedBanner({ notification }: { notification: Notification }) {
  const [expanded, setExpanded] = useState(false);
  const resolveMutation = useResolveNotification();
  const navigateToChat = useNavigateToChat(notification);

  const payload = parsePayload<EscalatedPayload>(notification.payload);
  const fixAttempts = payload?.fix_attempts || 3;
  const reason = payload?.reason;

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 cursor-pointer text-left flex-1"
        >
          <span>⛔</span>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-red-400" />
            : <ChevronRight className="w-4 h-4 text-red-400" />
          }
          <span className="font-medium text-red-900">
            Automation paused — needs your help
          </span>
          <span className="text-xs text-red-400 ml-2">{getRelativeTime(notification.timestamp)}</span>
        </button>
        <button
          onClick={() => resolveMutation.mutateAsync(notification.id)}
          className="p-1 text-red-300 hover:text-red-500 cursor-pointer rounded hover:bg-red-100"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {expanded && (
        <>
          <p className="text-sm text-red-700 mt-2 ml-7">
            AI tried {fixAttempts}x but couldn't fix it
            {reason && `: ${reason}`}
          </p>
          <div className="mt-3 ml-7 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer border-red-300 text-red-700 hover:bg-red-100"
              onClick={navigateToChat}
            >
              Discuss with AI
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function MaintenanceFailedBanner({ notification }: { notification: Notification }) {
  const [expanded, setExpanded] = useState(false);
  const resolveMutation = useResolveNotification();
  const navigateToChat = useNavigateToChat(notification);

  const payload = parsePayload<MaintenanceFailedPayload>(notification.payload);
  const explanation = payload?.explanation || "The auto-fix attempt was unsuccessful.";

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 cursor-pointer text-left flex-1"
        >
          <span>🔧</span>
          {expanded
            ? <ChevronDown className="w-4 h-4 text-amber-400" />
            : <ChevronRight className="w-4 h-4 text-amber-400" />
          }
          <span className="font-medium text-amber-900">
            Auto-fix failed — your input needed
          </span>
          <span className="text-xs text-amber-400 ml-2">{getRelativeTime(notification.timestamp)}</span>
        </button>
        <button
          onClick={() => resolveMutation.mutateAsync(notification.id)}
          className="p-1 text-amber-300 hover:text-amber-500 cursor-pointer rounded hover:bg-amber-100"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {expanded && (
        <>
          <p className="text-sm text-amber-700 mt-2 ml-7">{explanation}</p>
          <div className="mt-3 ml-7 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer border-amber-300 text-amber-700 hover:bg-amber-100"
              onClick={navigateToChat}
            >
              Discuss with AI
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
