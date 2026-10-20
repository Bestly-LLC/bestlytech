/**
 * The admin inside Bestly Cloud (cloud.bestly.tech/admin shows /admin in a frame).
 *
 * Security shape, on purpose small:
 * - NO sign-in bridge. The admin keeps its own sign-in and session. www.bestly.tech and
 *   cloud.bestly.tech are the same site, so the session the admin already has works in the frame.
 * - The ONLY origin allowed to frame /admin is https://cloud.bestly.tech (vercel.json frame-ancestors).
 *   This file is the second lock: if the admin is framed by anything else, it blanks and breaks out.
 * - The two pages talk by postMessage and only ever send a route path. Both sides check event.origin exactly.
 */
export const CLOUD_ORIGIN = "https://cloud.bestly.tech";

type WithAncestors = Location & { ancestorOrigins?: DOMStringList };

const onAdminPath = () => /^\/admin(\/|$)/.test(window.location.pathname);

export function isFramed(): boolean {
  try { return window.top !== window; } catch { return true; }
}

/** True only when every ancestor is exactly https://cloud.bestly.tech. */
export function framedByCloud(): boolean {
  if (!isFramed()) return false;
  const list = (window.location as WithAncestors).ancestorOrigins;
  if (list && list.length > 0) {
    for (let i = 0; i < list.length; i++) if (list[i] !== CLOUD_ORIGIN) return false;
    return true;
  }
  // Browsers without ancestorOrigins (Firefox): fall back to the referrer's origin.
  try { return !!document.referrer && new URL(document.referrer).origin === CLOUD_ORIGIN; } catch { return false; }
}

/** Embed mode: on an admin path and framed by Cloud. (?embed=cloud is only a hint; the frame check decides.) */
export const EMBEDDED: boolean = typeof window !== "undefined" && onAdminPath() && framedByCloud();

/**
 * Run first (embedGuard.ts imports it before anything else). Framed by anything other than Cloud on an
 * admin path: render nothing, try to break out to the top-level admin, and stop the app from booting.
 */
export function guardFraming(): void {
  if (typeof window === "undefined" || !onAdminPath() || !isFramed() || framedByCloud()) return;
  const here = window.location.origin + window.location.pathname + "?direct=1";
  try { window.stop(); } catch { /* ignore */ }
  try { document.documentElement.innerHTML = ""; } catch { /* nothing to blank */ }
  try { window.top!.location.replace(here); } catch { /* the browser may refuse top navigation; the page stays blank */ }
  throw new Error("Bestly Admin: blocked frame");
}

const ROUTE_RE = /^\/admin(\/[A-Za-z0-9._~%\-/]*)?$/;
export const isAdminRoute = (p: unknown): p is string =>
  typeof p === "string" && p.length < 300 && !p.includes("..") && !p.includes("//") && ROUTE_RE.test(p);

/** Tell Cloud which admin page this is (path only), so its address bar can follow. */
export function postRouteToCloud(pathname: string): void {
  if (!EMBEDDED || !isAdminRoute(pathname)) return;
  try { window.parent.postMessage({ type: "bestly-admin-route", path: pathname }, CLOUD_ORIGIN); } catch { /* parent gone */ }
}

/** Cloud can ask the admin to open one of its own routes (the header's Admin entry, tapped while already there). */
export function listenForCloud(go: (path: string) => void): () => void {
  if (!EMBEDDED) return () => {};
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== CLOUD_ORIGIN || e.source !== window.parent) return;
    const d = e.data as { type?: string; path?: string } | null;
    if (d?.type === "bestly-cloud-go" && isAdminRoute(d.path)) go(d.path);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/**
 * Apple sign-in cannot run inside a frame (Apple refuses to be framed), so in the frame it leaves for
 * the top-level admin and leaves this flag behind. When the admin loads signed-in at the top level and
 * the flag is set, it hops back into Cloud (AdminLayout). Not a session bridge: nothing is carried across.
 */
export const HOP_KEY = "bestly-cloud-hop";
export function setCloudHop(): void { try { sessionStorage.setItem(HOP_KEY, "1"); } catch { /* private mode */ } }
export function takeCloudHop(): boolean {
  try { const v = sessionStorage.getItem(HOP_KEY) === "1"; sessionStorage.removeItem(HOP_KEY); return v; } catch { return false; }
}
