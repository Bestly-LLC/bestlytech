/**
 * Keeps a long-open tab (or the desktop app) from running an old build.
 *
 * Every build writes /version.json with its own id and is compiled with that id inside it. When
 * the two stop matching a new build is live, so the app reloads itself — on the next time the tab
 * comes back to the front, or within five minutes. Without this, a page left open serves cached
 * code forever and a shipped fix looks like it never happened.
 *
 * Not in the admin or the partner portal: a reload there throws away where you were, and builds
 * land most hours. The admin offers "Reload now" instead (useDeployRefresh); both only reload by
 * themselves after you've been away for over an hour.
 *
 * 2026-10-11 (Jared: "when I play one of the example demos, it reverts back to software support"):
 * a new build used to reload the page the moment it was noticed, even mid-demo or mid-call with Maya.
 * Now a found build only waits: it swaps in when the visitor comes back to the tab after being away,
 * or after 3 minutes with no input while nothing is busy (no audio or video playing, Maya not open,
 * no element marked data-busy="true"). Never while someone is watching, listening or talking.
 */
import { useEffect } from "react";

declare const __BUILD_ID__: string;
const MINE = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "";
const ONCE = "bestly-reloaded-for";
const AWAY_MS = 60 * 60_000;
const keepsPlace = () => /^\/(admin|partner)(\/|$)/.test(window.location.pathname);
const IDLE_MS = 3 * 60_000;
const SHORT_AWAY_MS = 2 * 60_000;

/** Someone is watching, listening or talking: a reload now would throw that away. */
function busy(): boolean {
  if (document.querySelector('[data-busy="true"], [role="dialog"]')) return true;
  if (document.documentElement.classList.contains("maya-docked")) return true;
  for (const m of Array.from(document.querySelectorAll<HTMLMediaElement>("audio, video"))) {
    if (!m.paused && !m.ended) return true;
  }
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function useAppUpdate(everyMs = 300_000) {
  useEffect(() => {
    if (!MINE) return;
    let gone = false;
    let hiddenAt = 0;
    let pending: string | null = null;
    let lastInput = Date.now();

    const swap = () => {
      if (!pending || gone) return;
      // One reload per new build, so a bad deploy can never put us in a loop.
      if (sessionStorage.getItem(ONCE) === pending) { pending = null; return; }
      sessionStorage.setItem(ONCE, pending);
      window.location.reload();
    };
    const check = async (away = 0) => {
      if (gone || document.hidden) return;
      if (keepsPlace() && away < AWAY_MS) return;
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const { build } = await r.json();
        if (!build || build === MINE) return;
        pending = build;
        // Back from somewhere else: nothing on screen is mid-use, so swap now.
        if (away >= SHORT_AWAY_MS && !busy()) swap();
      } catch { /* offline: try again later */ }
    };
    const t = window.setInterval(() => check(), everyMs);
    const idle = window.setInterval(() => {
      if (pending && !document.hidden && Date.now() - lastInput > IDLE_MS && !busy()) swap();
    }, 15_000);
    const touched = () => { lastInput = Date.now(); };
    const inputs = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    inputs.forEach((e) => window.addEventListener(e, touched, { passive: true }));
    const back = () => {
      if (document.hidden) { hiddenAt = hiddenAt || Date.now(); return; }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      check(away);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    check();
    return () => {
      gone = true;
      window.clearInterval(t); window.clearInterval(idle);
      inputs.forEach((e) => window.removeEventListener(e, touched));
      document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back);
    };
  }, [everyMs]);
}
