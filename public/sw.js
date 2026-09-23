/* Bestly service worker — Web Push for bestly.tech/admin (and in-page alerts for /partner).
 *
 * No fetch handler on purpose: this worker never touches page loads or caching.
 * It only turns a push into an OS notification and opens the right page on click.
 *
 * Payload (from the push-notify edge function):
 *   { title, body, severity: "info" | "warning" | "critical", url, tag }
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Bestly Admin", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Bestly Admin";
  const critical = data.severity === "critical";
  const options = {
    body: data.body || "",
    icon: "/admin-icon-192.png",
    badge: "/admin-icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    requireInteraction: critical,
    timestamp: Date.now(),
    data: { url: data.url || "/admin" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/admin", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer a tab already on the same section (admin or partner), then any Bestly tab.
      const section = new URL(target).pathname.split("/")[1];
      const same = wins.find((w) => new URL(w.url).pathname.split("/")[1] === section) || wins[0];
      if (same) {
        await same.focus();
        if ("navigate" in same && same.url !== target) {
          try { await same.navigate(target); } catch { /* cross-origin or not controlled */ }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
