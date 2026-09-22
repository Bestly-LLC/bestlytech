/**
 * Keeps a long-open tab (or the desktop app) from running an old build.
 *
 * Every build writes /version.json with its own id and is compiled with that id inside it. When
 * the two stop matching a new build is live, so the app reloads itself — on the next time the tab
 * comes back to the front, or within five minutes. Without this, a page left open serves cached
 * code forever and a shipped fix looks like it never happened.
 */
import { useEffect } from "react";

declare const __BUILD_ID__: string;
const MINE = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "";
const ONCE = "bestly-reloaded-for";

export function useAppUpdate(everyMs = 300_000) {
  useEffect(() => {
    if (!MINE) return;
    let gone = false;
    const check = async () => {
      if (gone || document.hidden) return;
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
    const t = window.setInterval(check, everyMs);
    const back = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    check();
    return () => { gone = true; window.clearInterval(t); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [everyMs]);
}
