/* Bestly service worker — Web Push for bestly.tech/admin and for each partner's own Scout answers in /partner.
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
    icon: data.icon || "/admin-icon-192.png", // trip-push sends the trip's own icon for guests
    badge: data.icon || "/admin-icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    requireInteraction: critical,
    timestamp: Date.now(),
    data: { url: data.url || "/admin" },
  };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Partner Scout answers: if the portal is already on screen and focused, the page shows its
      // own alert, so drop the OS popup (it must still be shown once, or Safari revokes push).
      if (data.quiet_if_focused) {
        const section = new URL(options.data.url, self.location.origin).pathname.split("/")[1];
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        if (wins.some((w) => w.focused && w.visibilityState === "visible" && new URL(w.url).pathname.split("/")[1] === section)) {
          const shown = await self.registration.getNotifications({ tag: options.tag });
          shown.forEach((n) => n.close());
        }
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Links arrive as "/admin/claims" or "https://bestly.tech/admin/claims". A full link to our own site (bestly.tech or
  // www.bestly.tech) is turned into this origin's path; otherwise navigate() is cross-origin and silently does nothing.
  let raw = new URL((event.notification.data && event.notification.data.url) || "/admin", self.location.origin);
  if (raw.origin !== self.location.origin && /(^|\.)bestly\.tech$/i.test(raw.hostname) && !/^(cloud|studio|review)\./i.test(raw.hostname)) {
    raw = new URL(raw.pathname + raw.search + raw.hash, self.location.origin);
  }
  const target = raw.href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer a tab already on the same section (admin or partner), then any Bestly tab.
      const section = new URL(target).pathname.split("/")[1];
      const same = wins.find((w) => new URL(w.url).pathname.split("/")[1] === section) || wins[0];
      if (same) {
        await same.focus();
        if (same.url !== target) {
          let moved = false;
          if ("navigate" in same) {
            try { moved = !!(await same.navigate(target)); } catch { /* not controlled by this worker */ }
          }
          if (!moved) {
            // Uncontrolled window: ask the page to route itself, and open the link if nobody answers.
            same.postMessage({ type: "bestly-open", url: target });
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
