/**
 * Subtle 3D scroll effects for the trip pages (LAX + home). Nothing crazy:
 *  - Cards tilt up into place (rotateX + rise + fade) the first time they scroll into view.
 *  - The hero picture drifts slower than the page (parallax) and the headline eases up.
 * Works on whatever the page renders: every direct child of <main> that isn't a fixed overlay
 * (sheets, bottom bar, video player) gets the reveal; new children are picked up as data loads.
 * Transforms are cleared after the reveal so nothing inside is affected. Off with reduced motion.
 */
import { useEffect } from "react";

const HIDDEN = "perspective(900px) rotateX(12deg) translateY(28px) scale(0.98)";

export function ScrollFx() {
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const main = document.querySelector("main");
    if (!main) return;

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        io.unobserve(el);
        el.style.opacity = "1";
        el.style.transform = "none";
        // Clear the transform once done so fixed/sticky things inside behave normally.
        window.setTimeout(() => { el.style.transition = ""; el.style.transform = ""; el.style.willChange = ""; }, 900);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    const prime = () => {
      for (const node of Array.from(main.children)) {
        const el = node as HTMLElement;
        if (el.dataset.fx) continue;
        el.dataset.fx = "1";
        if (getComputedStyle(el).position === "fixed") continue;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.92) continue; // already on screen: leave it be
        el.style.opacity = "0";
        el.style.transform = HIDDEN;
        el.style.transformOrigin = "50% 0%";
        el.style.willChange = "transform, opacity";
        el.style.transition = "opacity 700ms ease, transform 800ms cubic-bezier(.2,.7,.2,1)";
        io.observe(el);
      }
    };
    prime();
    const mo = new MutationObserver(prime);
    mo.observe(main, { childList: true });

    // Parallax hero.
    const hero = document.querySelector<HTMLElement>("[data-fx-hero]");
    const title = document.querySelector<HTMLElement>("[data-fx-title]");
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = Math.min(window.scrollY, 400);
        if (hero) hero.style.transform = `translate3d(0, ${y * 0.35}px, 0) scale(${1 + y / 2400})`;
        if (title) { title.style.transform = `translate3d(0, ${y * 0.18}px, 0)`; title.style.opacity = String(Math.max(0, 1 - y / 260)); }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { io.disconnect(); mo.disconnect(); window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
