/** Where to land after an OAuth round trip (Apple always returns to /admin). Good for 10 minutes. */
const KEY = "bestly-admin-next";

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
    return Date.now() - at < 10 * 60_000 && next.startsWith("/admin") && !next.startsWith("//") ? next : null;
  } catch { return null; }
}
