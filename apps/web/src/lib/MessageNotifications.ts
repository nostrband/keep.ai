import { AssistantUIMessage } from "@app/proto";
import { notificationSound } from "./notification-sound";
import { KeepDbApi } from "@app/db";
import { notifyTablesChanged } from "../queryClient";
import { API_ENDPOINT } from "../const";

export class MessageNotifications {
  private isRunning = false;
  private desktopNotificationsEnabled: boolean | null = null;
  private lastConfigCheck = 0;
  private deviceId: string | null = null;

  async checkNewMessages(api: KeepDbApi): Promise<void> {
    // If already running, this is a noop
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      // Get device ID (cached after first call)
      if (!this.deviceId) {
        this.deviceId = await api.getDeviceId();
      }

      while (true) {
        // Use per-device notification tracking to properly support multi-device users
        const newMessages = await api.getNewAssistantMessagesForDevice(this.deviceId);

        // If no new messages, exit the loop
        if (newMessages.length === 0) {
          break;
        }

        // Process each message with 5-second pauses
        while (newMessages.length > 0) {
          const message = newMessages.shift()!;
          await this.showNotification(message);

          // Mark chat as notified on this specific device (not globally).
          // This allows other devices to still receive their own notifications.
          await api.chatStore.markChatNotifiedOnDevice(
            message.metadata!.threadId!,
            this.deviceId
          );
          notifyTablesChanged(["chat_notifications"], true, api);

          // Always sleep after a shown notif to make sure next one
          // isn't shown immediately
          await this.sleep(5000);
        }

        // After processing all messages, check again for new ones
        // This continues until no more messages are found
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async checkDesktopNotificationsEnabled(): Promise<boolean> {
    // Cache the setting for 60 seconds to avoid excessive API calls
    const now = Date.now();
    if (this.desktopNotificationsEnabled !== null && now - this.lastConfigCheck < 60000) {
      return this.desktopNotificationsEnabled;
    }

    try {
      const response = await fetch(`${API_ENDPOINT}/get_config`);
      if (response.ok) {
        const config = await response.json();
        this.desktopNotificationsEnabled = config.env.DESKTOP_NOTIFICATIONS !== "off";
        this.lastConfigCheck = now;
        return this.desktopNotificationsEnabled;
      }
    } catch (error) {
      console.debug("Failed to fetch desktop notifications setting:", error);
    }

    // Default to enabled if we can't fetch the setting
    return true;
  }

  private async showNotification(message: AssistantUIMessage): Promise<void> {
    // Check if desktop notifications are enabled
    const notificationsEnabled = await this.checkDesktopNotificationsEnabled();
    if (!notificationsEnabled) {
      return;
    }

    // Only show notifications if we're not looking at the UI tab
    if (globalThis.document?.visibilityState !== "visible") {
      // Only show notifications for non-user messages (assistant messages)
      if (message.role !== "user") {
        // Play notification sound
        try {
          await notificationSound?.play();
        } catch (error) {
          // Silently handle notification sound errors
          console.debug("Notification sound failed:", error);
        }

        // Show browser notification
        if ("Notification" in window) {
          try {
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
              const body = message.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join(" ");
              
              new Notification("Assistant:", {
                body,
                tag: message.id,
                silent: false,
              });
            }
          } catch (error) {
            console.debug("Browser notification failed:", error);
          }
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create a singleton instance
export const messageNotifications = new MessageNotifications();