import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// CY-GS: onIndexChange lets the host page reveal secondary content (FAQ / end
// CTA) only once the tour reaches its last step, keeping the default tour view
// within one mobile viewport (no scroll).

// Animated step carousel for the get-started tours. One step at a time with a
// direction-aware slide+fade (transform/opacity only, ~300ms, reduced-motion
// aware), skip-ahead dots, Back/Next, keyboard arrows, and swipe. UX-Pro-Max:
// never a locked linear tour — Back + clickable dots always available.
export function StepCarousel({
  steps,
  accent = "#2DB3A6",
  doneLabel = "You're all set ✓",
  className,
  onIndexChange,
}: {
  steps: ReactNode[];
  accent?: string;
  doneLabel?: string;
  className?: string;
  onIndexChange?: (index: number, total: number) => void;
}) {
  const n = steps.length;
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

  useEffect(() => {
    onIndexChange?.(i, n);
  }, [i, n, onIndexChange]);

  const go = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(n - 1, target));
      setDir(clamped >= i ? 1 : -1);
      setI(clamped);
    },
    [i, n]
  );
  const prev = useCallback(() => go(i - 1), [go, i]);
  const next = useCallback(() => go(i + 1), [go, i]);

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [prev, next]);

  const startX = useRef<number | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (startX.current == null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (dx < -48) next();
    else if (dx > 48) prev();
  };

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="group"
      aria-roledescription="carousel"
      aria-label={`Step ${i + 1} of ${n}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className={`relative flex min-h-0 flex-col rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${className ?? ""}`}
      style={{ ["--cy-accent" as string]: accent, touchAction: "pan-y" }}
    >
      {/* Progress header */}
      <div className="mb-3 sm:mb-5 flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground tabular-nums">
          Step {i + 1} of {n}
        </span>
        <div className="flex items-center gap-2" role="tablist" aria-label="Steps">
          {steps.map((_, k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-label={`Go to step ${k + 1}`}
              aria-selected={k === i}
              onClick={() => go(k)}
              className="h-2.5 rounded-full transition-all duration-300"
              style={{
                width: k === i ? 26 : 10,
                background: k === i ? accent : "hsl(var(--muted-foreground) / 0.3)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Slide viewport — flex-1 + min-h-0 so it absorbs the available height and
          clips internally; the progress header and Back/Next controls (shrink-0
          siblings) therefore stay visible at every window size, no scroll. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div key={i} className="cy-carousel-slide h-full overflow-hidden" data-dir={dir}>
          {steps[i]}
        </div>
      </div>

      {/* Controls */}
      <div className="mt-3 sm:mt-7 flex items-center justify-between">
        <button
          type="button"
          onClick={prev}
          disabled={i === 0}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>

        {i < n - 1 ? (
          <button
            type="button"
            onClick={next}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-transform active:scale-95"
            style={{ background: accent }}
          >
            Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="text-sm font-bold" style={{ color: accent }}>
            {doneLabel}
          </span>
        )}
      </div>
    </div>
  );
}
