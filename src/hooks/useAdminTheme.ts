import { useSyncExternalStore } from "react";

/**
 * Admin look: "bento" (light, soft cards, the default) or "dark" (the original black theme).
 * Stored per browser. The class `admin-bento` on the admin wrapper and <body> flips every
 * white/black utility (see tailwind.config.ts `white` / `black`) and the theme tokens in index.css.
 */
export type AdminTheme = "bento" | "dark";

const KEY = "bestly-admin-theme";
const listeners = new Set<() => void>();

function read(): AdminTheme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "bento";
  } catch {
    return "bento";
  }
}

let current: AdminTheme = typeof window === "undefined" ? "bento" : read();

export function setAdminTheme(next: AdminTheme) {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: keep it for this tab only */
  }
  listeners.forEach((l) => l());
}

export function useAdminTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => "bento" as AdminTheme,
  );
  return {
    theme,
    bento: theme === "bento",
    toggle: () => setAdminTheme(theme === "bento" ? "dark" : "bento"),
  };
}

/** Chart/SVG ink that follows the theme: white on dark, near-black on bento. */
export function adminInk(bento: boolean, alpha: number) {
  return bento ? `rgba(17,17,20,${alpha})` : `rgba(255,255,255,${alpha})`;
}
