/**
 * Guest trip alerts (Web Push) for the trip pages. Uses the same service worker (/sw.js) and VAPID key as the
 * admin, but subscriptions are saved per trip (audience "guest", keyed by the trip link) through the
 * trip-push edge function, which checks the token. No account needed.
 * iPhone: only works once the page is on the Home Screen (iOS 16.4+), which is why the toast asks for that first.
 */
const FN = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/trip-push";
export type TripPushState = "unsupported" | "denied" | "off" | "on";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const reg = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async (r) => { await navigator.serviceWorker.ready; return r; });

function bytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const post = (body: unknown) => fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

export async function tripPushState(): Promise<TripPushState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const r = await reg().catch(() => null);
  const sub = await r?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Call from a tap (Safari only asks from a user gesture). */
export async function enableTripPush(token: string): Promise<TripPushState> {
  if (!supported()) return "unsupported";
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const r = await reg();
  const { public_key } = await post({ action: "key" });
  if (!public_key) return "off";
  let sub = await r.pushManager.getSubscription();
  if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(public_key) });
  const res = await post({ token, subscription: sub.toJSON() });
  return res?.ok ? "on" : "off";
}

/** Quietly re-send the subscription on every visit (browsers rotate endpoints). */
export async function refreshTripPush(token: string) {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const r = await reg();
    const sub = await r.pushManager.getSubscription();
    if (sub) await post({ token, subscription: sub.toJSON() });
  } catch { /* best effort */ }
}
