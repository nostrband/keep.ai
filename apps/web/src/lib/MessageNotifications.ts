import { AssistantUIMessage } from "@app/proto";
import { notificationSound } from "../ui/lib/notification-sound";
import { KeepDbApi } from "@app/db";
import { notifyTablesChanged } from "../queryClient";

export class MessageNotifications {
  private isRunning = false;

  async checkNewMessages(api: KeepDbApi): Promise<void> {
    // If already running, this is a noop
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      while (true) {
        const newMessages = await api.getNewAssistantMessages();
        console.log("newAssistantMessages", newMessages);

        // If no new messages, exit the loop
        if (newMessages.length === 0) {
          break;
        }

        // Process each message with 5-second pauses
        while (newMessages.length > 0) {
          const message = newMessages.shift()!;
          await this.showNotification(message);

          // mark chat as read to make sure we don't repeat this notification
          // FIXME use separate notified_at? per device?
          await api.chatStore.readChat(message.metadata!.threadId!);
          notifyTablesChanged(["chats"], true, api);

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

  private async showNotification(message: AssistantUIMessage): Promise<void> {
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