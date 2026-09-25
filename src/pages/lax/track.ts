/**
 * Guest activity on trip pages → lax_guest_events (shown in admin: opened?, last seen, what they tapped).
 * Never counts the host: skipped when this browser is signed in to Bestly admin, has opened the admin
 * (it sets "bestly-host"), or the page is a ?demo preview — and, server-side, when this browser has
 * been seen on somebody else's trip page. Fire-and-forget; never blocks the page.
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * A stable id for this browser, so the server can tell one visitor from another.
 *
 * It is not an identity and it is not shared with anyone: a random string kept in this browser.
 * What it buys is the one rule that needs no setup from the host — a guest only ever sees their own
 * trip, so a browser that turns up on two different trip pages is the host, and the server retires
 * it. Before this, the host filter was three client-side checks and Jared's own phone passed all of
 * them: on 23 Sep he opened two links he had just sent and both logged as the guest.
 */
function deviceId(): string | undefined {
  try {
    let id = localStorage.getItem("bestly-did");
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).replace(/-/g, "").slice(0, 32);
      localStorage.setItem("bestly-did", id);
    }
    return id;
  } catch { return undefined; } // private mode: the server falls back to its other rules
}

export function isHostDevice(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (new URLSearchParams(window.location.search).has("demo")) return true;
    if (localStorage.getItem("bestly-host") === "1") return true;
    // Signed in to the Bestly admin on this browser (Supabase auth session).
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
    }
  } catch { /* private mode: treat as guest */ }
  return false;
}

function device(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/i.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Other";
  const br = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Edg/.test(ua) ? "Edge" : "Browser";
  const inApp = /Instagram|FBAN|FBAV|Line\//.test(ua) ? " (in-app)" : "";
  return `${os} ${br}${inApp}`;
}

const pathToken = () => (typeof window === "undefined" ? undefined : /\/t\/([^/?#]+)/.exec(window.location.pathname)?.[1]);

export function track(token: string | undefined, kind: string, detail?: Record<string, unknown>) {
  token = token || pathToken();
  if (!token || token.startsWith("demo-") || isHostDevice()) return;
  void (supabase.rpc("lax_track" as never, { p_token: token, p_kind: kind, p_detail: detail ?? null, p_device: device(), p_device_id: deviceId() } as never) as unknown as Promise<unknown>)
    .then(() => {}, () => {});
}
