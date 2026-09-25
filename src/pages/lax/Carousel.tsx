/**
 * Swipeable cards for the trip pages (native scroll-snap, so it feels like iOS and never fights vertical scrolling).
 *  - The next card peeks in from the right, so it's obvious there's more.
 *  - Big indicators + ‹ › buttons under it (tap to go back and forth), plus "Name · 2 of 4".
 *  - The height follows the card on screen (no tall empty gap under a short card).
 *  - First time on screen: a small peek (real scroll, so a finger on it never fights an animation). Once per visit.
 *  - Anything that jumps to an id inside a card (#charging, "open-section" events) brings that card forward.
 * v2: active card from an IntersectionObserver inside the scroller (the old offsetLeft math measured against the page,
 *     so taps on the dots could land on the wrong card and "back" sometimes didn't move); scroll-based nudge; auto height.
 */
import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { track } from "./track";

const PAD = 20; // matches px-5 / scroll-padding

export function Carousel({ id, labels, children, className = "" }: { id: string; labels?: string[]; children: ReactNode; className?: string }) {
  const slides = Children.toArray(children).filter(Boolean);
  const n = slides.length;
  const scroller = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [settled, setSettled] = useState(0); // the card it came to rest on (height follows this, never mid-swipe)
  const [h, setH] = useState<number | null>(null);
  const wanted = useRef<number | null>(null);
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const go = useCallback((i: number, smooth = true) => {
    const idx = Math.max(0, Math.min(n - 1, i));
    const el = scroller.current, kid = items.current[idx];
    if (!el || !kid) return;
    wanted.current = idx;
    el.scrollTo({ left: Math.max(0, kid.offsetLeft - PAD), behavior: smooth && !reduce ? "smooth" : "auto" });
  }, [n, reduce]);

  // Rigid paging, like iOS: one swipe = one card, and it always comes to rest on a whole card.
  // CSS snap alone let cards stop halfway on iPhone (momentum + the height change mid-swipe).
  useEffect(() => {
    const el = scroller.current;
    if (!el || n < 2) return;
    const nearest = () => {
      let best = 0, d = Infinity;
      items.current.forEach((k, i) => { if (!k) return; const x = Math.abs(k.offsetLeft - PAD - el.scrollLeft); if (x < d) { d = x; best = i; } });
      return best;
    };
    let touching = false, start = { x: 0, t: 0, i: 0 }, timer = 0, tries = 0;
    const settle = () => {
      if (touching) return;
      const want = wanted.current ?? nearest();
      const kid = items.current[want];
      if (!kid) return;
      const target = Math.max(0, Math.min(kid.offsetLeft - PAD, el.scrollWidth - el.clientWidth));
      if (Math.abs(el.scrollLeft - target) > 2) {
        // Self-heal: smooth first; if it still won't land, jump there and report it (watchdog → Scout).
        if (++tries > 3) { el.scrollLeft = target; track(undefined, "carousel_misaligned", { id, off: Math.round(el.scrollLeft - target) }); tries = 0; }
        else el.scrollTo({ left: target, behavior: reduce ? "auto" : "smooth" });
        return;
      }
      tries = 0;
      wanted.current = null;
      setSettled(want);
    };
    const onScroll = () => { window.clearTimeout(timer); timer = window.setTimeout(settle, 110); };
    const onStart = (e: TouchEvent) => { touching = true; wanted.current = null; start = { x: e.touches[0].clientX, t: Date.now(), i: nearest() }; };
    const onEnd = (e: TouchEvent) => {
      touching = false;
      const dx = start.x - (e.changedTouches[0]?.clientX ?? start.x);
      const v = Math.abs(dx) / Math.max(1, Date.now() - start.t);
      const step = Math.abs(dx) > 40 || v > 0.35 ? Math.sign(dx) : 0;
      go(start.i + step);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", settle as EventListener);
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("scroll", onScroll); el.removeEventListener("scrollend", settle as EventListener);
      el.removeEventListener("touchstart", onStart); el.removeEventListener("touchend", onEnd); el.removeEventListener("touchcancel", onEnd);
    };
  }, [n, go, reduce, id]);

  // Which card is on screen: the one most visible inside the scroller.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const seen = new Map<number, number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(Number((e.target as HTMLElement).dataset.i), e.intersectionRatio);
      let best = 0, r = -1;
      seen.forEach((v, k) => { if (v > r + 0.01) { r = v; best = k; } });
      setActive(best);
    }, { root: el, threshold: [0, 0.25, 0.5, 0.75, 1] });
    items.current.forEach((k) => k && io.observe(k));
    return () => io.disconnect();
  }, [n]);

  // Height follows the card on screen.
  useLayoutEffect(() => {
    const kid = items.current[settled];
    if (!kid || !("ResizeObserver" in window)) return;
    const ro = new ResizeObserver(() => setH(kid.offsetHeight));
    ro.observe(kid);
    setH(kid.offsetHeight);
    return () => ro.disconnect();
  }, [settled, n]);

  // Peek the next card the first time it's on screen (real scroll, so it can't fight a finger).
  useEffect(() => {
    const el = scroller.current;
    if (!el || n < 2 || reduce || !("IntersectionObserver" in window)) return;
    let done = false;
    try { done = sessionStorage.getItem(`nudged:${id}`) === "1"; } catch { /* ignore */ }
    if (done) return;
    let t1 = 0, t2 = 0;
    const cancel = () => { window.clearTimeout(t1); window.clearTimeout(t2); };
    const io = new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) return;
      io.disconnect();
      try { sessionStorage.setItem(`nudged:${id}`, "1"); } catch { /* ignore */ }
      t1 = window.setTimeout(() => {
        if (el.scrollLeft > 4) return;
        el.scrollTo({ left: 72, behavior: "smooth" });
        t2 = window.setTimeout(() => { if (el.scrollLeft < 100) el.scrollTo({ left: 0, behavior: "smooth" }); }, 420);
      }, 450);
    }, { threshold: 0.6 });
    io.observe(el);
    el.addEventListener("pointerdown", cancel, { once: true });
    return () => { io.disconnect(); cancel(); el.removeEventListener("pointerdown", cancel); };
  }, [id, n, reduce]);

  // Jump requests ("open-section" with an id inside one of the cards).
  useEffect(() => {
    const f = (e: Event) => {
      const target = document.getElementById(String((e as CustomEvent).detail));
      if (!target || !scroller.current?.contains(target)) return;
      const i = items.current.findIndex((k) => k?.contains(target));
      if (i >= 0) go(i);
    };
    window.addEventListener("open-section", f);
    return () => window.removeEventListener("open-section", f);
  }, [go]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(active + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(active - 1); }
  };
  const arrow = "grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-white ring-1 ring-white/15 transition active:scale-95 disabled:opacity-25";

  return (
    <div className={className} role="region" aria-roledescription="carousel" aria-label={labels?.join(", ")} onKeyDown={onKey}>
      <div ref={scroller}
        className="relative -mx-5 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollPaddingInline: PAD, WebkitOverflowScrolling: "touch", height: h != null && n > 1 ? h + 8 : undefined,
          transition: reduce ? undefined : "height 280ms cubic-bezier(.2,.8,.2,1)" }}>
        <div className="flex items-start gap-3">
          {slides.map((s, i) => (
            <div key={i} ref={(el) => { items.current[i] = el; }} data-i={i} aria-roledescription="slide"
              aria-label={`${i + 1} of ${n}${labels?.[i] ? `: ${labels[i]}` : ""}`}
              className="w-[calc(100%-2.25rem)] shrink-0 snap-start snap-always [&>*]:!mt-0">{s}</div>
          ))}
          {/* Room after the last card so it can snap to the same left edge as the others
              (browsers ignore the scroller's right padding, and a 0-height box adds no scroll room: keep h-px). */}
          {n > 1 && <div aria-hidden className="h-px w-[44px] shrink-0" />}
        </div>
      </div>
      {n > 1 && (
        <div className="mt-1.5 flex flex-col items-center">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous" onClick={() => go(active - 1)} disabled={active === 0} className={arrow}><ChevronLeft className="h-5 w-5" /></button>
            <div className="flex items-center" role="tablist">
              {slides.map((_, i) => (
                <button key={i} type="button" role="tab" aria-selected={i === active} aria-label={`Show ${labels?.[i] ?? `card ${i + 1}`}`} onClick={() => go(i)}
                  className="grid h-11 min-w-[30px] place-items-center px-1">
                  <span className="block h-3 rounded-full transition-[width,background-color] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]"
                    style={{ width: i === active ? 32 : 10, background: i === active ? "var(--trip-accent)" : "rgba(255,255,255,.3)" }} />
                </button>
              ))}
            </div>
            <button type="button" aria-label="Next" onClick={() => go(active + 1)} disabled={active === n - 1} className={arrow}><ChevronRight className="h-5 w-5" /></button>
          </div>
          <p className="mt-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60" aria-live="polite">
            {labels?.[active] ? `${labels[active]} · ` : ""}{active + 1} of {n}
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
