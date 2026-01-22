import { useNavigate } from "react-router-dom";
import { Button } from "../ui";
import { Notification } from "packages/db/dist";
import { useAcknowledgeNotification, useResolveNotification } from "../hooks/useNotifications";

interface ErrorPayload {
  error_type?: "auth" | "permission" | "network" | "internal";
  service?: string;
  message?: string;
}

function parsePayload(payload: string): ErrorPayload | null {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

interface WorkflowErrorAlertProps {
  notification: Notification;
}

/**
 * Error alert banner for workflow hub page.
 * Shows unresolved errors with action buttons.
 */
export function WorkflowErrorAlert({ notification }: WorkflowErrorAlertProps) {
  const navigate = useNavigate();
  const acknowledgeMutation = useAcknowledgeNotification();
  const resolveMutation = useResolveNotification();

  const payload = parsePayload(notification.payload);
  const errorType = payload?.error_type || "internal";
  const service = payload?.service;
  const message = payload?.message || "An error occurred";

  const errorTypeLabels: Record<string, string> = {
    auth: "Authentication",
    permission: "Permission",
    network: "Network",
    internal: "Internal",
  };

  const getActionButton = () => {
    switch (errorType) {
      case "auth":
        return {
          label: service ? `Reconnect ${service}` : "Reconnect",
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

  const handleDismiss = async () => {
    await acknowledgeMutation.mutateAsync(notification.id);
  };

  const actionButton = getActionButton();

  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3">
        <span className="text-xl">⚠️</span>
        <div className="flex-1">
          <h3 className="font-medium text-red-900">
            {errorTypeLabels[errorType]} error
          </h3>
          <p className="text-sm text-red-700 mt-1">{message}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          onClick={actionButton.onClick}
          disabled={resolveMutation.isPending}
        >
          {actionButton.label}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          disabled={acknowledgeMutation.isPending}
          className="text-red-700 hover:text-red-900"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
