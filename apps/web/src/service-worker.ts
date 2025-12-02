/// <reference lib="webworker" />

import { Event } from "nostr-tools";
import { nip44_v3 } from "@app/sync";

declare const self: ServiceWorkerGlobalScope;

// PWA cache configuration
const CACHE_NAME = "keep-ai-v1";
const urlsToCache: string[] = [
  // '/',
  // '/index.html',
  // '/src/main.tsx',
  // '/src/index.css',
  // '/manifest.json'
];

// Installation event - cache resources
self.addEventListener("install", (event: ExtendableEvent) => {
  console.log("[SW] Installing service worker");
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Opened cache");
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log("[SW] Resources cached");
        return self.skipWaiting();
      })
  );
});

// Activation event - clean up old caches
self.addEventListener("activate", (event: ExtendableEvent) => {
  console.log("[SW] Activating service worker");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log("[SW] Deleting old cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log("[SW] Service worker activated");
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener("fetch", (event: FetchEvent) => {
  // Only handle GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // Skip chrome-extension and non-http requests
  if (!event.request.url.startsWith("http")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cached version or fetch from network
      return response || fetch(event.request);
    })
  );
});

const handlePush = async (event: PushEvent) => {
  console.log("[SW] Push notification received:", event);

  if (!event.data) {
    console.log("[SW] Push event has no data");
    return;
  }

  try {
    const clientsList = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const hasVisibleClient = clientsList.some(
      (client: any) => client.visibilityState === "visible" && "focus" in client
    );
    if (hasVisibleClient) {
      console.log("[SW] Push event suppressed for visible client");
      return;
    }
  } catch {}

  try {
    const pushData = event.data.text();
    console.log("[SW] Push data received:", pushData);

    // Parse the Nostr event (kind 24683)
    const nostrEvent: Event = JSON.parse(pushData);

    if (nostrEvent.kind !== 24683) {
      console.log("[SW] Invalid event kind:", nostrEvent.kind);
      return;
    }

    // Get stored push configuration
    const pushConfig = await getStoredPushConfig();
    if (!pushConfig) {
      console.log("[SW] No push config found");
      return;
    }

    // Verify sender pubkey matches the one we subscribed for
    if (nostrEvent.pubkey !== pushConfig.senderPubkey) {
      console.log(
        "[SW] Sender pubkey mismatch:",
        nostrEvent.pubkey,
        "vs",
        pushConfig.senderPubkey
      );
      return;
    }

    // Decrypt the event content using our stored key
    const decryptedContent = await decryptEventContent(
      nostrEvent.content,
      pushConfig.privateKey,
      nostrEvent.pubkey
    );

    // Parse the decrypted payload as AssistantUIMessage
    const message = JSON.parse(decryptedContent);
    console.log("[SW] Decrypted message:", message);

    // Extract notification text from message parts
    const notificationText = extractNotificationText(message);

    // Show the notification
    const notificationOptions: NotificationOptions = {
      body: notificationText,
      icon: "/icon-192x192.png",
      badge: "/icon-192x192.png",
      tag: message.id || "keep-ai-message",
      requireInteraction: true,
    };

    event.waitUntil(
      self.registration.showNotification(
        "Keep.AI Assistant",
        notificationOptions
      )
    );
  } catch (error) {
    console.error("[SW] Error handling push notification:", error);
  }
};

// Push notification event
self.addEventListener("push", (event) => event.waitUntil(handlePush(event)));

// Notification click event
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  console.log("[SW] Notification click received:", event);

  event.notification.close();

  if (event.action === "view" || !event.action) {
    // Open or focus the app
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then((clients) => {
        // Check if app is already open
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            return client.focus();
          }
        }
        // Open new window if not already open
        return self.clients.openWindow("/");
      })
    );
  }
});

// Helper function to get stored push configuration
async function getStoredPushConfig(): Promise<{
  senderPubkey: string;
  privateKey: Uint8Array;
} | null> {
  try {
    // We'll store this in IndexedDB when setting up push notifications
    const db = await openPushConfigDB();
    const transaction = db.transaction(["config"], "readonly");
    const store = transaction.objectStore("config");
    const request = store.get("push-config");

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          resolve({
            senderPubkey: result.senderPubkey,
            privateKey: new Uint8Array(result.privateKey),
          });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("[SW] Error getting stored push config:", error);
    return null;
  }
}

// Helper function to open IndexedDB for push config
function openPushConfigDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("keep-ai-push-config", 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config", { keyPath: "id" });
      }
    };
  });
}

// Helper function to decrypt event content using NIP-44 v3
async function decryptEventContent(
  ciphertext: string,
  privateKey: Uint8Array,
  senderPubkey: string
): Promise<string> {
  try {
    // Get conversation key for decryption
    const conversationKey = nip44_v3.getConversationKey(
      privateKey,
      senderPubkey
    );

    // Decrypt the content
    return nip44_v3.decrypt(ciphertext, conversationKey);
  } catch (error) {
    console.error("[SW] Error decrypting content:", error);
    throw error;
  }
}

// Helper function to extract notification text from AssistantUIMessage
function extractNotificationText(message: any): string {
  try {
    if (message.parts && Array.isArray(message.parts)) {
      const textParts = message.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join(" ");

      if (textParts.trim()) {
        return (
          textParts.trim().substring(0, 120) +
          (textParts.length > 120 ? "..." : "")
        );
      }
    }

    if (message.content && typeof message.content === "string") {
      return (
        message.content.substring(0, 120) +
        (message.content.length > 120 ? "..." : "")
      );
    }

    return "New message from Assistant";
  } catch (error) {
    console.error("[SW] Error extracting notification text:", error);
    return "New message from Assistant";
  }
}

// Export for main thread to access
export {};
