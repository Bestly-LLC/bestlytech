import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scroll to the element with this id when the page is opened at /page#id (the stuck card's "Update key" lands on the right card).
 * The target renders after its data loads, so this looks for it for about 3 seconds instead of once.
 */
export function useHashScroll(id: string) {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== `#${id}`) return;
    let tries = 0;
    let t = 0;
    const go = () => {
      const el = document.getElementById(id);
      if (el) {
        const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
        return;
      }
      if (++tries < 12) t = window.setTimeout(go, 250);
    };
    t = window.setTimeout(go, 150);
    return () => window.clearTimeout(t);
  }, [hash, id]);
}
