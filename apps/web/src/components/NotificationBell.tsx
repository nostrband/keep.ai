import { Link } from "react-router-dom";
import { useUnresolvedNotifications } from "../hooks/useUnresolvedNotifications";

/**
 * Notification bell icon with badge showing unresolved notification count.
 * Clicking the bell navigates to the notifications page.
 */
export function NotificationBell() {
  const { data } = useUnresolvedNotifications();
  const count = data?.count ?? 0;

  return (
    <Link
      to="/notifications"
      className="relative h-8 w-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
      aria-label={count > 0 ? `${count} unresolved notifications` : "Notifications"}
    >
      {/* Bell icon (from Heroicons) */}
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>
      {/* Badge with count */}
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-medium rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
