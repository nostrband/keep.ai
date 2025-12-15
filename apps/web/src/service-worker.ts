/// <reference lib="webworker" />

import { Event, getPublicKey, SimplePool } from "nostr-tools";
import { DEFAULT_RELAYS, nip44_v3 } from "@app/sync";
import { API_ENDPOINT } from "./const";
import { FileReceiver, getStreamFactory } from "@app/sync";
import { getDefaultCompression } from "@app/browser";
import { hexToBytes } from "nostr-tools/utils";
import { ServerlessNostrSigner } from "./lib/signer";

declare const __SERVERLESS__: boolean;
const isServerless = __SERVERLESS__; // (import.meta as any).env?.VITE_FLAVOR === "serverless";

declare const self: ServiceWorkerGlobalScope;

// Storage for file transfer keys
interface FileTransferKeys {
  localPrivkey: string;
  peerPubkey: string;
}

let fileTransferKeys: FileTransferKeys | null = null;
let fileReceiver: FileReceiver | null = null;
let pool: SimplePool | null = null;

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
        console.log("[SW] Resources cached ");
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

  const url = new URL(event.request.url);

  // Intercept /files/get/* requests
  if (url.pathname.startsWith("/files/get/")) {
    event.respondWith(handleFileRequest(event.request));
  } else {
    event.respondWith(
      caches.match(event.request).then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
    );
  }
});

// Listen for messages from main thread
self.addEventListener("message", async (event) => {
  console.log("[SW] got message", event);
  const { type, payload } = event.data || {};

  if (type === "FILE_TRANSFER_KEYS") {
    console.log("[SW] Received file transfer keys");
    fileTransferKeys = payload;

    // Initialize FileReceiver and pool when we get keys
    try {
      await initializeFileReceiver();
    } catch (error) {
      console.error("[SW] Failed to initialize FileReceiver:", error);
    }
  }
});

// Initialize FileReceiver with the received keys
async function initializeFileReceiver() {
  if (!fileTransferKeys) {
    console.warn("[SW] No file transfer keys available");
    return;
  }

  try {
    // Create pool if not exists
    if (!pool) {
      pool = new SimplePool({
        enablePing: true,
        enableReconnect: true,
      });
    }

    // Create ServerlessNostrSigner for the service worker
    const localPrivkey = hexToBytes(fileTransferKeys.localPrivkey);
    const swSigner = new ServerlessNostrSigner();
    swSigner.setKey(localPrivkey);

    // Create stream factory
    const factory = getStreamFactory();
    factory.compression = getDefaultCompression();

    // Create FileReceiver
    const localPubkey = getPublicKey(localPrivkey);

    fileReceiver = new FileReceiver({
      signer: swSigner,
      pool,
      factory,
      localPubkey,
      peerPubkey: fileTransferKeys.peerPubkey,
      relays: DEFAULT_RELAYS,
    });

    // Start the receiver
    fileReceiver.start();
    console.log("[SW] FileReceiver initialized and started");
  } catch (error) {
    console.error("[SW] Error initializing FileReceiver:", error);
  }
}

async function handleFileRequest(request: Request) {
  const url = new URL(request.url);
  const name = url.pathname.replace("/files/get/", "");

  const cache = await caches.open("files-v1");

  // 1) Try cache first
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    console.log("[SW] Serving file from cache", name);
    return cachedResponse;
  }

  // 2) In serverless mode, check if FileReceiver is ready
  console.log("[SW] fetch", url, {
    isServerless,
    fileReceiver,
    fileTransferKeys,
  });
  if (isServerless) {
    // Check if receiver or keys are not set - return error response
    if (!fileReceiver || !fileTransferKeys) {
      console.warn("[SW] Service worker not ready - missing receiver or keys");
      return new Response(
        JSON.stringify({ error: "Service worker not ready, reload the page" }),
        {
          status: 503,
          statusText: "Service worker not ready, reload the page",
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log("[SW] Downloading file via nostr:", name);

    try {
      // Download file using FileReceiver
      let { stream: reader, mimeType: contentType } =
        await fileReceiver.download(name);

      // Collect all chunks
      const chunks: Uint8Array[] = [];
      for await (const chunk of reader) {
        if (chunk instanceof Uint8Array) {
          chunks.push(chunk);
        }
      }

      // Combine chunks into single buffer
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const fileData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        fileData.set(chunk, offset);
        offset += chunk.length;
      }

      // Determine content type from filename extension
      const ext = name.split(".").pop()?.toLowerCase();
      if (!contentType) {
        contentType = "application/octet-stream";
        if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
        else if (ext === "png") contentType = "image/png";
        else if (ext === "gif") contentType = "image/gif";
        else if (ext === "pdf") contentType = "application/pdf";
        else if (ext === "txt") contentType = "text/plain";
        else if (ext === "json") contentType = "application/json";
      }

      // Create response
      const response = new Response(fileData, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });

      // Cache the response
      await cache.put(request, response.clone());

      console.log("[SW] Downloaded and cached file via nostr:", name);
      return response;
    } catch (error) {
      console.error("[SW] Failed to download file via nostr:", error);
      // Fall through to API download as fallback
    }
  }

  // 3) Fallback to API download
  console.log("[SW] Downloading file via API:", name);
  const response = await fetch(
    `${API_ENDPOINT}/file/get?url=${encodeURIComponent(name)}`
  );

  // 4) Put into cache for next time
  // Note: must clone before putting, because a Response body can only be used once
  await cache.put(request, response.clone());

  return response;
}

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
if (isServerless) {
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
}

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
