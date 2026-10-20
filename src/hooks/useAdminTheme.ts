import { useSyncExternalStore } from "react";
import { EMBEDDED, initialCloudTheme, listenForCloudTheme } from "@/lib/cloudEmbed";

/**
 * Admin look: "bento" (light, soft cards, the default) or "dark" (the original black theme).
 * Top level (?direct=1 and the installed app): stored per browser, the admin's own toggle flips it.
 * Inside Bestly Cloud (EMBEDDED): Cloud's header control is the only control. The admin follows what Cloud
 * says (first paint from the frame URL, then live by postMessage, see cloudEmbed.ts) and never stores or
 * changes it itself. The class `admin-bento` on the admin wrapper and <body> flips every white/black utility
 * (see tailwind.config.ts `white` / `black`) and the theme tokens in index.css.
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

const fromCloud = (t: "light" | "dark"): AdminTheme => (t === "dark" ? "dark" : "bento");

let current: AdminTheme = typeof window === "undefined" ? "bento" : EMBEDDED ? fromCloud(initialCloudTheme()) : read();

/** Lets <html> carry the theme from the first paint on, so a reload or a frame navigation never flashes the wrong one. */
function markHtml() {
  if (typeof document !== "undefined" && EMBEDDED) document.documentElement.setAttribute("data-embed-theme", current === "dark" ? "dark" : "light");
}
markHtml();

/** A 180 ms colour crossfade (index.css `html.theme-xfade`). None with reduced motion. */
let fadeTimer: ReturnType<typeof setTimeout> | undefined;
function crossfade() {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch {
    return; // no matchMedia: just skip the fade
  }
  const html = document.documentElement;
  html.classList.add("theme-xfade");
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => html.classList.remove("theme-xfade"), 220);
}

function commit(next: AdminTheme, store: boolean) {
  if (next === current) return;
  crossfade();
  current = next;
  markHtml();
  if (store) {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: keep it for this tab only */
    }
  }
  listeners.forEach((l) => l());
}

/** Top-level admin only. Inside Cloud this does nothing: Cloud decides. */
export function setAdminTheme(next: AdminTheme) {
  if (EMBEDDED) return;
  commit(next, true);
}

if (EMBEDDED) listenForCloudTheme((t) => commit(fromCloud(t), false));

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
    /** True inside Cloud: the admin has no theme control of its own there. */
    followsCloud: EMBEDDED,
    toggle: () => setAdminTheme(theme === "bento" ? "dark" : "bento"),
  };
}

/** Chart/SVG ink that follows the theme: white on dark, near-black on bento. */
export function adminInk(bento: boolean, alpha: number) {
  return bento ? `rgba(17,17,20,${alpha})` : `rgba(255,255,255,${alpha})`;
}
