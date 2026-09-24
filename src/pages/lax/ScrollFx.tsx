/**
 * Subtle 3D scroll effects for the trip pages (LAX + home), tuned for smoothness on phones:
 *  - Cards rise and tilt into place the first time they scroll into view (transform + opacity only,
 *    GPU-composited, staggered 70ms when several arrive together, cleaned up on transitionend).
 *  - The hero picture drifts slower than the page and the headline eases up (rAF, only while the
 *    hero is on screen).
 * Every direct child of <main> that isn't a fixed overlay gets the reveal; new children are picked
 * up as data loads. Nothing runs with reduced motion.
 */
import { useEffect } from "react";

const HIDDEN = "perspective(1100px) rotateX(7deg) translate3d(0, 22px, 0)";
const EASE = "cubic-bezier(.16, 1, .3, 1)"; // smooth "ease-out-expo" settle, close to an iOS spring

export function ScrollFx() {
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const main = document.querySelector("main");
    if (!main) return;

    const reveal = (el: HTMLElement, delay: number) => {
      el.style.transitionDelay = `${delay}ms`;
      el.style.opacity = "1";
      el.style.transform = "translate3d(0,0,0)";
      const done = () => {
        el.removeEventListener("transitionend", done);
        // Clear everything so fixed/sticky children and later layout behave normally.
        el.style.transition = ""; el.style.transitionDelay = ""; el.style.transform = ""; el.style.willChange = ""; el.style.backfaceVisibility = "";
      };
      el.addEventListener("transitionend", done);
      window.setTimeout(done, 1200 + delay); // safety net if transitionend never fires
    };

    const io = new IntersectionObserver((entries) => {
      let n = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        reveal(e.target as HTMLElement, Math.min(n++, 4) * 70);
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });

    const prime = () => {
      for (const node of Array.from(main.children)) {
        const el = node as HTMLElement;
        if (el.dataset.fx) continue;
        el.dataset.fx = "1";
        if (getComputedStyle(el).position === "fixed") continue;
        if (el.getBoundingClientRect().top < window.innerHeight * 0.94) continue; // already visible: leave it
        el.style.opacity = "0";
        el.style.transform = HIDDEN;
        el.style.transformOrigin = "50% 0%";
        el.style.backfaceVisibility = "hidden";
        el.style.willChange = "transform, opacity";
        el.style.transition = `opacity 520ms ${EASE}, transform 700ms ${EASE}`;
        io.observe(el);
      }
    };
    prime();
    const mo = new MutationObserver(prime);
    mo.observe(main, { childList: true });

    // Parallax hero: only while it's on screen; transform-only so it stays on the compositor.
    const hero = document.querySelector<HTMLElement>("[data-fx-hero]");
    const title = document.querySelector<HTMLElement>("[data-fx-title]");
    if (hero) { hero.style.backfaceVisibility = "hidden"; hero.style.transformOrigin = "50% 100%"; }
    let raf = 0, last = -1;
    const frame = () => {
      raf = 0;
      const y = window.scrollY;
      if (y > 420 && last > 420) return;
      last = y;
      const c = Math.min(Math.max(y, 0), 420);
      if (hero) hero.style.transform = `translate3d(0, ${(c * 0.32).toFixed(1)}px, 0) scale(${(1 + c / 2600).toFixed(4)})`;
      if (title) { title.style.transform = `translate3d(0, ${(c * 0.16).toFixed(1)}px, 0)`; title.style.opacity = Math.max(0, 1 - c / 240).toFixed(3); }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(frame); };
    window.addEventListener("scroll", onScroll, { passive: true });
    frame();
    return () => { io.disconnect(); mo.disconnect(); window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  // Keep the pages contained: no sideways wiggle from animating cards, carousels don't drag the
  // page or trigger back-swipe, sheets don't scroll the page behind them, anchor jumps glide.
  return (
    <style>{`:root:has(.trip){scroll-behavior:smooth;overscroll-behavior-x:none}
.trip{overflow-x:clip}
.trip [aria-roledescription="carousel"]{overscroll-behavior-x:contain;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch}
.trip [role="dialog"] .overflow-y-auto{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
@media (prefers-reduced-motion: reduce){:root:has(.trip){scroll-behavior:auto}}`}</style>
  );
}
