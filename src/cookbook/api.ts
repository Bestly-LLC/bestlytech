// Family Cookbook: talking to the server. Every call carries the cookbook's own session token (never a Bestly Cloud
// password or token). Who may see what is decided in SQL; this file only sends and receives.

const SB_URL = ((import.meta.env.VITE_SUPABASE_URL as string) || "https://rcqfqhguwpmaarseifqg.supabase.co").replace(/\/$/, "");
const SB_KEY = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? "") as string);

const TOKEN_KEY = "fc_token";
let memToken = "";
export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || memToken; } catch { return memToken; }
}
export function setToken(t: string) {
  memToken = t;
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* private window: the token lives until the page closes */ }
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message?: string) { super(message || code); this.code = code; this.status = status; }
}

/** What a person reads when something goes wrong. */
export function plainError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : "";
  const m: Record<string, string> = {
    not_signed_in: "You were signed out. Sign in again.",
    not_found: "That one is not here any more.",
    not_allowed: "Only the person who added it, or Jared, can change this.",
    bad_title: "Give it a name first.",
    bad_recipe: "This recipe is missing its ingredients or steps.",
    too_big: "That is too long to save.",
    not_ready: "That card is still being read.",
    already_saved: "That card is already saved.",
    not_in_review: "That card was already checked.",
    offline: "No connection right now. Try again in a moment.",
  };
  if (code && m[code]) return m[code];
  if (e instanceof ApiError && e.message && e.message !== e.code && /\s/.test(e.message)) return e.message;
  return "Something went wrong. Try again.";
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init); } catch { throw new ApiError("offline", 0); }
}

export async function rpc<T = any>(name: string, args: Record<string, unknown> = {}, withToken = true): Promise<T> {
  const body = withToken ? { p_token: getToken(), ...args } : args;
  const r = await send(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY }, body: JSON.stringify(body),
  });
  if (r.ok) { const t = await r.text(); return (t ? JSON.parse(t) : null) as T; }
  let msg = "";
  try { msg = (await r.json()).message || ""; } catch { /* no body */ }
  const code = /^[a-z_]+$/.test(msg) ? msg : "error";
  throw new ApiError(code, r.status, msg);
}

export async function fn<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const r = await send(`${SB_URL}/functions/v1/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY }, body: JSON.stringify(body),
  });
  let j: any = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok || (j && j.ok === false)) throw new ApiError(r.status === 401 ? "not_signed_in" : "error", r.status, (j && j.error) || "");
  return j as T;
}

/** Send one shrunk photo. The first call (no capture) starts a card; a second call with the capture id adds its back. */
export async function uploadPhoto(blob: Blob, side: "front" | "back", captureId?: string): Promise<{ capture_id: string; photo_id: string }> {
  const fd = new FormData();
  fd.set("token", getToken());
  fd.set("side", side);
  if (captureId) fd.set("capture_id", captureId);
  fd.set("photo", blob, side + ".jpg");
  const r = await send(`${SB_URL}/functions/v1/family-upload`, { method: "POST", headers: { apikey: SB_KEY }, body: fd });
  let j: any = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok || !j || j.ok === false) throw new ApiError(r.status === 401 ? "not_signed_in" : "error", r.status, (j && j.error) || "That photo did not go through. Try again.");
  return j;
}

/* ===== photos: fetched with the token, shown from a local blob address ===== */
const photoCache = new Map<string, Promise<string>>();
export function photoUrl(id: string): Promise<string> {
  let p = photoCache.get(id);
  if (!p) {
    p = (async () => {
      const r = await send(`${SB_URL}/functions/v1/family-photo?p=${encodeURIComponent(id)}`, { headers: { "x-family-token": getToken(), apikey: SB_KEY } });
      if (!r.ok) throw new ApiError("not_found", r.status);
      return URL.createObjectURL(await r.blob());
    })();
    p.catch(() => photoCache.delete(id));
    photoCache.set(id, p);
  }
  return p;
}
/** Local pictures of cards just taken, so they show instantly (keyed by capture id). */
const localPics = new Map<string, string>();
export const setLocalPic = (captureId: string, url: string) => { localPics.set(captureId, url); };
export const getLocalPic = (captureId: string) => localPics.get(captureId);

/** Forget every picture address (sign out, so nothing of one person is left for the next). */
export function forgetPhotos() {
  photoCache.forEach((p) => p.then((u) => URL.revokeObjectURL(u)).catch(() => {}));
  photoCache.clear();
  localPics.forEach((u) => URL.revokeObjectURL(u));
  localPics.clear();
}

let io: IntersectionObserver | null = null;
function fill(img: HTMLImageElement) {
  const id = img.dataset.photo;
  if (!id || img.dataset.state) return;
  img.dataset.state = "loading";
  const local = img.dataset.local && getLocalPic(img.dataset.local);
  const done = (u: string) => { img.src = u; img.dataset.state = "ok"; img.closest(".thumb,.hero-img,.zoombox")?.classList.add("has-pic"); };
  if (local) { done(local); return; }
  photoUrl(id).then(done).catch(() => { img.dataset.state = "err"; });
}
/** Fill every <img data-photo="id"> under root, a little before it scrolls into view. */
export function hydratePhotos(root: ParentNode = document) {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-photo]"));
  if (!imgs.length) return;
  if (!("IntersectionObserver" in window)) { imgs.forEach(fill); return; }
  if (!io) io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io!.unobserve(e.target); fill(e.target as HTMLImageElement); } }), { rootMargin: "400px 0px" });
  imgs.forEach((i) => { if (!i.dataset.state) io!.observe(i); });
}

/* ===== sign in with Bestly Cloud ===== */
export async function startSignIn(): Promise<string> {
  const j = await fn<{ url: string }>("family-auth", { op: "start" });
  return j.url;
}
export async function finishSignIn(code: string, state: string): Promise<{ token: string; me: any }> {
  return fn("family-auth", { op: "exchange", code, state });
}
