import { useParams, useNavigate } from "react-router-dom";
import SharedHeader from "./SharedHeader";
import { NotificationCard } from "./NotificationCard";
import { useNotifications, useResolveNotification } from "../hooks/useNotifications";
import { useDbQuery } from "../hooks/dbQuery";
import { Button } from "../ui";
import { Notification } from "packages/db/dist";

/**
 * Notifications page - displays actionable items requiring user attention.
 * Can be filtered by workflowId via route parameter.
 */
export default function NotificationsPage() {
  const { workflowId } = useParams<{ workflowId?: string }>();
  const navigate = useNavigate();
  const { api } = useDbQuery();
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotifications({
    workflowId,
  });
  const resolveNotification = useResolveNotification();

  const notifications = data?.notifications ?? [];

  const navigateToChat = async (notification: Notification, seedMessage: string) => {
    if (!api) return;
    try {
      const workflow = await api.scriptStore.getWorkflow(notification.workflow_id);
      if (workflow?.chat_id) {
        navigate(`/chats/${workflow.chat_id}?message=${encodeURIComponent(seedMessage)}`);
        return;
      }
    } catch {
      // fall through
    }
    navigate(`/workflows/${notification.workflow_id}`);
  };

  const handleAction = async (notification: Notification, action: string) => {
    switch (action) {
      case "reconnect":
        navigate("/settings");
        break;
      case "check_permissions":
        navigate(`/workflows/${notification.workflow_id}`);
        break;
      case "retry":
        navigate(`/workflows/${notification.workflow_id}`);
        break;
      case "view_details":
        navigate(`/workflows/${notification.workflow_id}`);
        break;
      case "replan": {
        const payload = notification.payload ? JSON.parse(notification.payload) : {};
        const seedMessage = notification.type === "maintenance_failed"
          ? `The auto-fix failed: ${payload.explanation || "unknown reason"}. Let's discuss how to resolve this.`
          : `The automation needs help (AI tried ${payload.fix_attempts || 3}x). Let's discuss how to fix this.`;
        await navigateToChat(notification, seedMessage);
        break;
      }
      default:
        if (action.startsWith("answer_")) {
          await resolveNotification.mutateAsync(notification.id);
        }
    }
  };

  const handleViewWorkflow = (notification: Notification) => {
    navigate(`/workflows/${notification.workflow_id}`);
  };

  const handleResolve = async (notification: Notification) => {
    await resolveNotification.mutateAsync(notification.id);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SharedHeader title="Notifications" />
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center text-gray-500">
            <p className="text-lg">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (notifications.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SharedHeader title="Notifications" />
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center py-12">
            <span className="text-4xl mb-4 block">✓</span>
            <p className="text-lg font-medium text-gray-900">All caught up!</p>
            <p className="text-sm text-gray-500 mt-2">
              No notifications requiring your attention.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Notifications" />
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="space-y-4">
          {notifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onAction={handleAction}
              onViewWorkflow={handleViewWorkflow}
              onResolve={handleResolve}
            />
          ))}
        </div>

        {/* Load more button */}
        {hasNextPage && (
          <div className="mt-6 text-center">
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
