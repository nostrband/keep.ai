import { useState, useRef, useEffect } from "react";
import { Notification } from "packages/db/dist";
import { Button } from "../ui";
import { openBugReport } from "../lib/bugReport";
import { X, Bug } from "lucide-react";

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

interface MaintenanceFailedPayload {
  script_run_id?: string;
  explanation?: string;
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

/**
 * Expandable text component that detects clamping and shows "Show more"/"Show less" toggle.
 */
function ExpandableText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      setIsClamped(el.scrollHeight > el.clientHeight);
    }
  }, [text]);

  return (
    <div>
      <p
        ref={textRef}
        className={`text-sm text-gray-600 mt-1 ${expanded ? "" : "line-clamp-3"} ${className || ""}`}
      >
        {text}
      </p>
      {isClamped && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-blue-600 hover:text-blue-800 mt-1 cursor-pointer"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
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

  const handleReportIssue = () => {
    const payload = parsePayload<any>(notification.payload);
    openBugReport({
      errorType: notification.type,
      message: payload?.message || payload?.explanation || payload?.reason || "",
      workflowId: notification.workflow_id,
      workflowTitle: notification.workflow_title,
      timestamp: notification.timestamp,
    });
  };

  const renderContent = () => {
    switch (notification.type) {
      case "error":
        return <ErrorCard notification={notification} onAction={onAction} />;
      case "escalated":
        return <EscalatedCard notification={notification} onAction={onAction} />;
      case "maintenance_failed":
        return <MaintenanceFailedCard notification={notification} onAction={onAction} />;
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
      className={`relative border rounded-lg p-4 ${
        isResolved ? "bg-gray-50 border-gray-200" : "bg-white border-gray-300"
      }`}
    >
      {/* Top-right action icons: report + dismiss */}
      {!isResolved && (
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <button
            onClick={handleReportIssue}
            className="p-1 text-gray-300 hover:text-gray-500 cursor-pointer rounded hover:bg-gray-100"
            title="Report issue"
          >
            <Bug className="w-3.5 h-3.5" />
          </button>
          {onResolve && (
            <button
              onClick={() => onResolve(notification)}
              className="p-1 text-gray-300 hover:text-gray-500 cursor-pointer rounded hover:bg-gray-100"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {renderContent()}

      {/* Footer with workflow title (clickable) and time */}
      <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
        <span>
          {onViewWorkflow ? (
            <button
              onClick={() => onViewWorkflow(notification)}
              className="hover:text-gray-700 underline cursor-pointer"
            >
              {notification.workflow_title || "Unknown workflow"}
            </button>
          ) : (
            notification.workflow_title || "Unknown workflow"
          )}
          {" "}&middot; {relativeTime}
        </span>
        {isResolved && (
          <span className="text-green-600 font-medium">Resolved</span>
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
      <div className="flex items-start gap-3 pr-16">
        <span className="text-xl">⚠️</span>
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">
            {errorTypeLabels[errorType]} error
          </h3>
          <p className="text-sm text-gray-600 mt-1">{message}</p>
        </div>
      </div>
      {!notification.resolved_at && onAction && actionButton && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer border-red-300 text-red-700 hover:bg-red-50"
            onClick={() => onAction(notification, actionButton.action)}
          >
            {actionButton.label}
          </Button>
        </div>
      )}
    </div>
  );
}

function EscalatedCard({
  notification,
  onAction,
}: {
  notification: Notification;
  onAction?: (notification: Notification, action: string) => void;
}) {
  const payload = parsePayload<EscalatedPayload>(notification.payload);
  const fixAttempts = payload?.fix_attempts || 3;
  const reason = payload?.reason;

  return (
    <div>
      <div className="flex items-start gap-3 pr-16">
        <span className="text-xl">⛔</span>
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">
            Automation paused — needs your help
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            AI tried {fixAttempts}x but couldn't fix it
            {reason && `: ${reason}`}
          </p>
        </div>
      </div>
      {!notification.resolved_at && onAction && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => onAction(notification, "replan")}
          >
            Discuss with AI
          </Button>
        </div>
      )}
    </div>
  );
}

function MaintenanceFailedCard({
  notification,
  onAction,
}: {
  notification: Notification;
  onAction?: (notification: Notification, action: string) => void;
}) {
  const payload = parsePayload<MaintenanceFailedPayload>(notification.payload);
  const explanation = payload?.explanation || "The auto-fix attempt was unsuccessful.";

  return (
    <div>
      <div className="flex items-start gap-3 pr-16">
        <span className="text-xl">🔧</span>
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">
            Auto-fix failed — your input needed
          </h3>
          <ExpandableText text={explanation} />
        </div>
      </div>
      {!notification.resolved_at && onAction && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => onAction(notification, "replan")}
          >
            Discuss with AI
          </Button>
        </div>
      )}
    </div>
  );
}

function ScriptMessageCard({ notification }: { notification: Notification }) {
  const payload = parsePayload<ScriptMessagePayload>(notification.payload);
  const title = payload?.title;
  const message = payload?.message || "Message from automation";

  return (
    <div className="flex items-start gap-3 pr-16">
      <span className="text-xl">📬</span>
      <div className="flex-1">
        <h3 className="font-medium text-gray-900">
          {title || message.split("\n")[0].slice(0, 50)}
        </h3>
        {(title || message.length > 50) && (
          <ExpandableText text={message} />
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
      <div className="flex items-start gap-3 pr-16">
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
              variant="outline"
              className="cursor-pointer"
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
