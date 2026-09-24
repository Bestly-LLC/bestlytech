/**
 * Swipeable cards for the trip pages (native scroll-snap, so it feels like iOS and never fights vertical scrolling).
 *  - The next card peeks in from the right, so it's obvious there's more.
 *  - Extra-large indicators under it (tap one to jump), plus "2 of 4" and the card's name.
 *  - The first time it scrolls into view it does a small spring nudge (left, bounce back) as a "swipe me" hint.
 *    Once per page visit; skipped with reduced motion.
 *  - Anything that jumps to an id inside a card (#charging, "open-section" events, scrollIntoView) brings that card forward.
 */
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function Carousel({ id, labels, children, className = "" }: { id: string; labels?: string[]; children: ReactNode; className?: string }) {
  const slides = Children.toArray(children).filter(Boolean);
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [nudge, setNudge] = useState(false);

  const onScroll = useCallback(() => {
    const el = scroller.current; if (!el) return;
    const kids = Array.from(el.children[0]?.children ?? []) as HTMLElement[];
    const left = el.scrollLeft + 24;
    let best = 0;
    kids.forEach((k, i) => { if (k.offsetLeft <= left) best = i; });
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) best = kids.length - 1;
    setActive(best);
  }, []);
  const go = (i: number) => {
    const el = scroller.current; const kid = el?.children[0]?.children[i] as HTMLElement | undefined;
    if (el && kid) el.scrollTo({ left: kid.offsetLeft - 20, behavior: "smooth" });
  };

  // Spring nudge the first time it's on screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el || slides.length < 2 || !("IntersectionObserver" in window)) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let done = false;
    try { done = sessionStorage.getItem(`nudged:${id}`) === "1"; } catch { /* ignore */ }
    if (done) return;
    const io = new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) return;
      io.disconnect();
      try { sessionStorage.setItem(`nudged:${id}`, "1"); } catch { /* ignore */ }
      window.setTimeout(() => { setNudge(true); window.setTimeout(() => setNudge(false), 1300); }, 350);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [id, slides.length]);

  // Jump requests ("open-section" with an id inside one of the cards).
  useEffect(() => {
    const f = (e: Event) => {
      const target = document.getElementById(String((e as CustomEvent).detail));
      const el = scroller.current; if (!target || !el || !el.contains(target)) return;
      const kids = Array.from(el.children[0]?.children ?? []);
      const i = kids.findIndex((k) => k.contains(target));
      if (i >= 0) go(i);
    };
    window.addEventListener("open-section", f);
    return () => window.removeEventListener("open-section", f);
  }, []);

  return (
    <div className={className} role="region" aria-roledescription="carousel" aria-label={labels?.join(", ")}>
      <div ref={scroller} onScroll={onScroll}
        className="-mx-5 snap-x snap-mandatory overflow-x-auto overscroll-x-contain px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollPaddingInline: 20, WebkitOverflowScrolling: "touch" }}>
        <div className={`flex items-stretch gap-3 ${nudge ? "trip-nudge" : ""}`}>
          {slides.map((s, i) => (
            <div key={i} aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}${labels?.[i] ? `: ${labels[i]}` : ""}`}
              className="w-[calc(100%-2.25rem)] shrink-0 snap-start [&>*]:!mt-0 [&>*]:h-full">{s}</div>
          ))}
        </div>
      </div>
      {slides.length > 1 && (
        <div className="mt-2 flex flex-col items-center">
          <div className="flex items-center" role="tablist">
            {slides.map((_, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === active} aria-label={`Show ${labels?.[i] ?? `card ${i + 1}`}`} onClick={() => go(i)}
                className="grid h-11 min-w-[36px] place-items-center px-1">
                <span className="block h-3 rounded-full transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
                  style={{ width: i === active ? 36 : 12, background: i === active ? "var(--trip-accent)" : "rgba(255,255,255,.28)" }} />
              </button>
            ))}
          </div>
          <p className="-mt-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60">
            {labels?.[active] ? `${labels[active]} · ` : ""}{active + 1} of {slides.length}
            {active === 0 && <span className="ml-1 normal-case tracking-normal text-white/45">· swipe →</span>}
          </p>
        </div>
      )}
    </div>
  );
}

/** On the trip: swipe between the cards. Otherwise: the same cards stacked as usual. */
export function TripSlides({ on, id, labels, children }: { on: boolean; id: string; labels: string[]; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return <Carousel id={id} labels={labels} className="mt-6">{children}</Carousel>;
}
