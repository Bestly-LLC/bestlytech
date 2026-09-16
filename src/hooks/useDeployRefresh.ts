import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

/**
 * The admin is a single-page app, so a tab left open keeps running the build it loaded,
 * even after Vercel ships a new one. Check the live index.html for a new bundle:
 * - coming back to the tab (phone app switch) with a new build: reload right away
 * - new build found while you're working: reload on your next page change, and offer a button
 */
const BUNDLE_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
const CHECK_MS = 2 * 60_000;

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

    const check = async (fromVisibility: boolean) => {
      const live = await liveBundle();
      if (!live || live === mine) return;
      stale.current = true;
      if (fromVisibility) { window.location.reload(); return; }
      if (!toasted.current) {
        toasted.current = true;
        toast("New version of the admin is ready", {
          description: "It loads on your next page change.",
          duration: Infinity,
          action: { label: "Reload now", onClick: () => window.location.reload() },
        });
      }
    };

    const onVisible = () => { if (document.visibilityState === "visible") check(true); };
    const timer = window.setInterval(() => check(false), CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    check(false);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  // Swap to the new build on navigation, when nothing half-typed is on screen.
  useEffect(() => {
    if (stale.current) window.location.reload();
  }, [location.pathname]);
}
