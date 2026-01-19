// Transform Gmail API method names to simpler, user-friendly names
export function transformGmailMethod(method: string): string {
  const methodMap: Record<string, string> = {
    "users.messages.list": "read messages",
    "users.messages.get": "read messages",
    "users.messages.attachments.get": "read attachments",
    "users.history.list": "read history",
    "users.threads.get": "read threads",
    "users.threads.list": "read threads",
    "users.getProfile": "read profile",
  };

  return methodMap[method] || method.split(".").pop() || method;
}

// Format duration into short rounded format (e.g., "2d", "5h", "30m", "45s")
export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}
