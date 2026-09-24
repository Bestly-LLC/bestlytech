/**
 * Guest activity on trip pages → lax_guest_events (shown in admin: opened?, last seen, what they tapped).
 * Never counts the host: skipped when this browser is signed in to Bestly admin, has opened the admin
 * (it sets "bestly-host"), or the page is a ?demo preview. Fire-and-forget; never blocks the page.
 */
import { supabase } from "@/integrations/supabase/client";

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
  if (!token || isHostDevice()) return;
  void (supabase.rpc("lax_track" as never, { p_token: token, p_kind: kind, p_detail: detail ?? null, p_device: device() } as never) as unknown as Promise<unknown>)
    .then(() => {}, () => {});
}
