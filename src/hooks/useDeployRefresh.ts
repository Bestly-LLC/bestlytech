import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

/**
 * The admin is a single-page app, so a tab left open keeps running the build it loaded,
 * even after Vercel ships a new one. Check the live index.html for a new bundle:
 * - new build found: a quiet "Reload now" button, and it swaps in on your next page change
 * - coming back to the tab does NOT reload any more. It used to, and since something ships
 *   most hours, leaving for five minutes cost you your place (Jared, 2026-09-22).
 * - 2026-09-24: an old tab kept showing an older Guest Trips page ("it went back") because the
 *   toast was missed and no page change happened. Now it also swaps by itself once you've been idle
 *   for 20s with nothing being typed (same URL, so you stay on the same page).
 */
const BUNDLE_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
const CHECK_MS = 2 * 60_000;
const IDLE_MS = 20_000;

/** Something is being typed or edited right now, so a reload would lose it. */
function busyTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!document.querySelector('[role="dialog"]');
}

function currentBundle(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return el?.getAttribute("src")?.match(BUNDLE_RE)?.[0] ?? null;
}

async function liveBundle(): Promise<string | null> {
  try {
    const res = await fetch(`/admin?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "text/html" } });
    if (!res.ok) return null;
    return (await res.text()).match(BUNDLE_RE)?.[0] ?? null;
  } catch {
    return null;
  }
}

export function useDeployRefresh() {
  const location = useLocation();
  const stale = useRef(false);
  const toasted = useRef(false);

  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return; // dev server: nothing to compare

    const check = async () => {
      const live = await liveBundle();
      if (!live || live === mine) return;
      stale.current = true;
      if (!toasted.current) {
        toasted.current = true;
        toast("New version of the admin is ready", {
          description: "It loads by itself in a few seconds, or on your next page change.",
          duration: Infinity,
          action: { label: "Reload now", onClick: () => window.location.reload() },
        });
      }
    };

    // Idle swap: once stale, reload after 20s without input while nothing is being typed.
    let lastInput = Date.now();
    const touched = () => { lastInput = Date.now(); };
    const idle = window.setInterval(() => {
      if (stale.current && Date.now() - lastInput > IDLE_MS && !busyTyping()) window.location.reload();
    }, 5_000);
    const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    inputs.forEach((e) => window.addEventListener(e, touched, { passive: true }));

    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const timer = window.setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    check();
    return () => {
      window.clearInterval(timer); window.clearInterval(idle);
      inputs.forEach((e) => window.removeEventListener(e, touched));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Swap to the new build on navigation, when nothing half-typed is on screen.
  useEffect(() => {
    if (stale.current) window.location.reload();
  }, [location.pathname]);
}
