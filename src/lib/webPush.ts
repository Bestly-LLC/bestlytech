/**
 * Real OS notifications (Web Push) for the admin: Safari and Chrome on the Mac, and the
 * home-screen app on iPhone.
 *
 * - The service worker is public/sw.js. It is registered on every admin load.
 * - Subscribing needs the browser's permission, and Safari only asks from a click, so the
 *   first time is the "Turn on" button in the bell. After that every load quietly re-sends
 *   the subscription (browsers rotate them) so push-notify always has a live endpoint.
 * - The VAPID public key comes from the push-subscribe edge function (the private key never
 *   leaves Supabase Vault). Subscriptions land in public.push_subscriptions.
 */
import { supabase } from "@/integrations/supabase/client";

export type PushState = "unsupported" | "denied" | "off" | "on";
/** admin = your alerts (bell, Scout). partner = a partner's own Scout answers, nothing else. */
export type PushAudience = "admin" | "partner";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

let reg: Promise<ServiceWorkerRegistration | null> | null = null;
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!reg) {
    reg = navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async (r) => {
        await navigator.serviceWorker.ready;
        return r;
      })
      .catch(() => null);
  }
  return reg;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let cachedKey: string | null = null;
async function publicKey(audience: PushAudience): Promise<string> {
  if (cachedKey) return cachedKey;
  const { data, error } = await supabase.functions.invoke("push-subscribe", { body: { action: "key", audience } });
  const k = (data as { public_key?: string } | null)?.public_key;
  if (error || !k) throw new Error(error?.message ?? "no push key");
  cachedKey = k;
  return k;
}

async function save(sub: PushSubscription, audience: PushAudience) {
  const { error } = await supabase.functions.invoke("push-subscribe", { body: { subscription: sub.toJSON(), audience } });
  if (error) throw new Error(error.message);
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const r = await registerServiceWorker();
  const sub = await r?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Must be called from a click (Safari refuses otherwise). */
export async function enablePush(audience: PushAudience = "admin"): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  // Ask first, synchronously inside the click, before any await loses the gesture.
  const asked = Notification.permission === "granted" ? Promise.resolve("granted" as NotificationPermission) : Notification.requestPermission();
  const perm = await asked;
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const r = await registerServiceWorker();
  if (!r) return "unsupported";
  const key = await publicKey(audience);
  let sub = await r.pushManager.getSubscription();
  // A subscription made with a different key can't be used; start over.
  const have = sub?.options?.applicationServerKey;
  if (sub && have) {
    const a = new Uint8Array(have), b = b64urlToBytes(key);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
  await save(sub, audience);
  return "on";
}

export async function disablePush(audience: PushAudience = "admin"): Promise<PushState> {
  const r = await registerServiceWorker();
  const sub = await r?.pushManager.getSubscription();
  if (sub) {
    await supabase.functions.invoke("push-subscribe", { body: { action: "remove", endpoint: sub.endpoint, audience } }).catch(() => {});
    // One browser subscription serves both admin and partner; only drop it when it's the admin's own switch.
    if (audience === "admin") await sub.unsubscribe().catch(() => false);
  }
  return pushSupported() ? (Notification.permission === "denied" ? "denied" : "off") : "unsupported";
}

/** On every admin load: register the worker and, if already allowed, re-send the subscription. */
export async function syncPushOnLoad(audience: PushAudience = "admin"): Promise<PushState> {
  if (!pushSupported()) { registerServiceWorker(); return "unsupported"; }
  const r = await registerServiceWorker();
  if (!r || Notification.permission !== "granted") return Notification.permission === "denied" ? "denied" : "off";
  try {
    const key = await publicKey(audience);
    let sub = await r.pushManager.getSubscription();
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
    await save(sub, audience);
    return "on";
  } catch {
    return "off";
  }
}

export async function sendTestPush(): Promise<{ sent: number; failed: number } | null> {
  const { data, error } = await supabase.functions.invoke("push-notify", {
    body: { title: "Bestly Admin", body: "Test alert. If you can read this outside the browser, desktop alerts work.", severity: "info", url: "/admin", tag: "test" },
  });
  if (error) return null;
  return data as { sent: number; failed: number };
}

/** A local OS notification through the service worker (used by the partner portal's Scout). */
export async function showLocalNotification(title: string, body: string, url: string, tag?: string): Promise<boolean> {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    const r = await registerServiceWorker();
    if (r) {
      await r.showNotification(title, { body, icon: "/admin-icon-192.png", badge: "/admin-icon-192.png", tag, data: { url } });
      return true;
    }
    const n = new Notification(title, { body, icon: "/admin-icon-192.png", tag });
    n.onclick = () => { window.focus(); window.location.href = url; n.close(); };
    return true;
  } catch {
    return false;
  }
}
