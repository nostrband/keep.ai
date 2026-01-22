import { Notification } from "packages/db/dist";
import { Button } from "../ui";

interface ErrorPayload {
  error_type?: "auth" | "permission" | "network" | "internal";
  service?: string;
  message?: string;
}

interface EscalatedPayload {
  fix_attempts?: number;
  reason?: string;
}

interface ScriptMessagePayload {
  title?: string;
  message?: string;
}

interface ScriptAskPayload {
  question?: string;
  context?: string;
  options?: string[];
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
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

interface NotificationCardProps {
  notification: Notification;
  onAction?: (notification: Notification, action: string) => void;
  onViewWorkflow?: (notification: Notification) => void;
  onResolve?: (notification: Notification) => void;
}

export function NotificationCard({
  notification,
  onAction,
  onViewWorkflow,
  onResolve,
}: NotificationCardProps) {
  const isResolved = !!notification.resolved_at;
  const relativeTime = getRelativeTime(notification.timestamp);

  const renderContent = () => {
    switch (notification.type) {
      case "error":
        return <ErrorCard notification={notification} onAction={onAction} />;
      case "escalated":
        return <EscalatedCard notification={notification} />;
      case "script_message":
        return <ScriptMessageCard notification={notification} />;
      case "script_ask":
        return <ScriptAskCard notification={notification} onAction={onAction} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={`border rounded-lg p-4 ${
        isResolved ? "bg-gray-50 border-gray-200" : "bg-white border-gray-300"
      }`}
    >
      {renderContent()}

      {/* Footer with workflow title and time */}
      <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
        <span>{notification.workflow_title || "Unknown workflow"} · {relativeTime}</span>
        {isResolved && (
          <span className="text-green-600 font-medium">Resolved</span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex gap-2 flex-wrap">
        {onViewWorkflow && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewWorkflow(notification)}
            className="text-gray-600"
          >
            View workflow →
          </Button>
        )}
        {!isResolved && onResolve && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onResolve(notification)}
            className="text-gray-500"
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

function ErrorCard({
  notification,
  onAction,
}: {
  notification: Notification;
  onAction?: (notification: Notification, action: string) => void;
}) {
  const payload = parsePayload<ErrorPayload>(notification.payload);
  const errorType = payload?.error_type || "internal";
  const service = payload?.service;
  const message = payload?.message || "An error occurred";

  const errorTypeLabels: Record<string, string> = {
    auth: "Authentication",
    permission: "Permission",
    network: "Network",
    internal: "Internal",
  };

  const actionButtons: Record<string, { label: string; action: string }> = {
    auth: { label: service ? `Reconnect ${service}` : "Reconnect", action: "reconnect" },
    permission: { label: "Check Permissions", action: "check_permissions" },
    network: { label: "Retry Now", action: "retry" },
    internal: { label: "View Details", action: "view_details" },
  };

  const actionButton = actionButtons[errorType];

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="text-xl">⚠️</span>
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">
            {errorTypeLabels[errorType]} error
          </h3>
          <p className="text-sm text-gray-600 mt-1">{message}</p>
        </div>
      </div>
      {onAction && actionButton && !notification.resolved_at && (
        <div className="mt-3">
          <Button
            size="sm"
            onClick={() => onAction(notification, actionButton.action)}
          >
            {actionButton.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function EscalatedCard({ notification }: { notification: Notification }) {
  const payload = parsePayload<EscalatedPayload>(notification.payload);
  const fixAttempts = payload?.fix_attempts || 3;
  const reason = payload?.reason;

  return (
    <div className="flex items-start gap-3">
      <span className="text-xl">⛔</span>
      <div className="flex-1">
        <h3 className="font-medium text-gray-900">
          Automation paused - needs your help
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          AI tried {fixAttempts}x but couldn't fix it
          {reason && `: ${reason}`}
        </p>
      </div>
    </div>
  );
}

function ScriptMessageCard({ notification }: { notification: Notification }) {
  const payload = parsePayload<ScriptMessagePayload>(notification.payload);
  const title = payload?.title;
  const message = payload?.message || "Message from automation";

  return (
    <div className="flex items-start gap-3">
      <span className="text-xl">📬</span>
      <div className="flex-1">
        <h3 className="font-medium text-gray-900">
          {title || message.split("\n")[0].slice(0, 50)}
        </h3>
        {(title || message.length > 50) && (
          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{message}</p>
        )}
      </div>
    </div>
  );
}

function ScriptAskCard({
  notification,
  onAction,
}: {
  notification: Notification;
  onAction?: (notification: Notification, action: string) => void;
}) {
  const payload = parsePayload<ScriptAskPayload>(notification.payload);
  const question = payload?.question || "Confirmation needed";
  const context = payload?.context;
  const options = payload?.options || ["Yes", "No"];

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="text-xl">❓</span>
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">{question}</h3>
          {context && (
            <p className="text-sm text-gray-600 mt-1">{context}</p>
          )}
        </div>
      </div>
      {onAction && !notification.resolved_at && options.length > 0 && (
        <div className="mt-3 flex gap-2">
          {options.map((option, index) => (
            <Button
              key={index}
              size="sm"
              variant={index === 0 ? "default" : "outline"}
              onClick={() => onAction(notification, `answer_${index}`)}
            >
              {option}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
