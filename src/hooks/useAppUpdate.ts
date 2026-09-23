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
 */
import { useEffect } from "react";

declare const __BUILD_ID__: string;
const MINE = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "";
const ONCE = "bestly-reloaded-for";
const AWAY_MS = 60 * 60_000;
const keepsPlace = () => /^\/(admin|partner)(\/|$)/.test(window.location.pathname);

export function useAppUpdate(everyMs = 300_000) {
  useEffect(() => {
    if (!MINE) return;
    let gone = false;
    let hiddenAt = 0;
    const check = async (away = 0) => {
      if (gone || document.hidden) return;
      if (keepsPlace() && away < AWAY_MS) return;
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const { build } = await r.json();
        if (!build || build === MINE) return;
        // One reload per new build, so a bad deploy can never put us in a loop.
        if (sessionStorage.getItem(ONCE) === build) return;
        sessionStorage.setItem(ONCE, build);
        window.location.reload();
      } catch { /* offline: try again later */ }
    };
    const t = window.setInterval(() => check(), everyMs);
    const back = () => {
      if (document.hidden) { hiddenAt = hiddenAt || Date.now(); return; }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      check(away);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    check();
    return () => { gone = true; window.clearInterval(t); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [everyMs]);
}
