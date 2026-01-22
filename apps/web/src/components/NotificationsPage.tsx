import SharedHeader from "./SharedHeader";

/**
 * Notifications page - displays all notifications for the user.
 * This is a placeholder that will be fully implemented in Spec 03.
 */
export default function NotificationsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SharedHeader title="Notifications" />
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="text-center text-gray-500">
          <p className="text-lg">All caught up!</p>
          <p className="text-sm mt-2">You have no notifications.</p>
        </div>
      </div>
    </div>
  );
}
