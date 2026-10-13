/** Where to land after an OAuth round trip (Apple always returns to /admin). Good for 10 minutes. */
const KEY = "bestly-admin-next";

/** Where a sign-in may send you back to: anywhere in the admin, or one Ava approval link (/y/<7 characters>). Never off-site. */
export const isSafeNext = (n: string) => !n.startsWith("//") && (n.startsWith("/admin") || /^\/y\/[a-z0-9]{7}$/.test(n));

/** Paths that wear the admin shell: /admin/... and Ava's one-tap approval page (/y/<code>). Keeps the public-site chrome (page fade, light loader) off them. */
export const isAdminSurface = (pathname: string) => pathname.startsWith("/admin") || /^\/y\/[A-Za-z0-9]{7}$/.test(pathname);

export function rememberNext(next: string) {
  if (!next || next === "/admin") return;
  try { localStorage.setItem(KEY, JSON.stringify({ next, at: Date.now() })); } catch { /* private mode */ }
}

export function takeNext(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const { next, at } = JSON.parse(raw) as { next: string; at: number };
    return Date.now() - at < 10 * 60_000 && isSafeNext(next) ? next : null;
  } catch { return null; }
}
