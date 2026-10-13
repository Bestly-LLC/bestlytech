import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { InteractiveDotGrid } from "@/components/InteractiveDotGrid";
import { MagneticButton } from "@/components/wow/MagneticButton";
import { HERO_SCENES } from "./scenes";

/* Homepage hero — 30 rotating "An AI that…" scenes (approved 2026-10-12).
 *
 * Layers, back to front: photo (cross-fade + cursor parallax) → feathered scrims →
 * the interactive dot grid (dots, spider web, ripples) → copy.
 *
 * - Advances every 8 s. Pauses only via the pause button or while the tab is hidden.
 *   (No pause-on-hover: the hero fills the screen, so the cursor is almost always over it.)
 * - Reduced motion: still advances, but with plain cross-fades and no parallax.
 * - Self-heal: a photo that fails to load is skipped; if every photo fails, the dot grid
 *   still carries the hero on its own.
 * - Only the next photo is preloaded.
 */

const INTERVAL_MS = 8000;
const SPRING = { type: "spring", bounce: 0, duration: 0.6 } as const;
const PHONE = "(213) 641-0074";

const heroPills = [
  "Answers 24/7",
  "Works in the apps you already use",
  "Tells callers it’s an AI",
  "Never sells your data",
];

const srcFor = (img: string, mobile: boolean) => (mobile ? img.replace(".webp", "-m.webp") : img);

export function HeroScenes() {
  const reduce = useReducedMotion();
  const total = HERO_SCENES.length;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [progressKey, setProgressKey] = useState(0);
  const failed = useRef<Set<number>>(new Set());

  const go = useCallback(
    (dir: 1 | -1) => {
      setI((cur) => {
        let next = cur;
        for (let n = 0; n < total; n++) {
          next = (next + dir + total) % total;
          if (!failed.current.has(next)) return next;
        }
        return cur;
      });
      setProgressKey((k) => k + 1);
    },
    [total],
  );

  // Auto-advance
  const running = !paused && !hidden;
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => go(1), INTERVAL_MS);
    return () => window.clearTimeout(t);
  }, [running, i, go, progressKey]);

  // Pause when the tab is hidden
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Preload only the next photo
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  useEffect(() => {
    const next = HERO_SCENES[(i + 1) % total];
    const img = new Image();
    img.src = srcFor(next.image, isMobile);
  }, [i, total, isMobile]);

  // Cursor parallax (springs start from the live value, so it never jumps)
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const px = useSpring(mx, { stiffness: 60, damping: 20, mass: 1 });
  const py = useSpring(my, { stiffness: 60, damping: 20, mass: 1 });
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width - 0.5) * -24);
    my.set(((e.clientY - r.top) / r.height - 0.5) * -16);
  };

  const scene = HERO_SCENES[i];
  const textIn = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 18, filter: "blur(6px)" },
        animate: { opacity: 1, y: 0, filter: "blur(0px)" },
        exit: { opacity: 0, y: -14, filter: "blur(6px)" },
      };

  return (
    <section
      className="relative overflow-hidden min-h-[92vh] flex items-center wow-bg-ink wow-text-paper"
      onPointerMove={onPointerMove}
      onPointerLeave={() => { mx.set(0); my.set(0); }}
      aria-roledescription="carousel"
      aria-label="What Bestly's AI agents do"
    >
      {/* Photo layer */}
      <motion.div className="absolute -inset-8" style={{ x: px, y: py }} aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.img
            key={scene.id}
            src={srcFor(scene.image, isMobile)}
            alt=""
            decoding="async"
            fetchPriority={i === 0 ? "high" : "auto"}
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ opacity: 0, scale: reduce ? 1 : 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 1.1, ease: [0.32, 0.72, 0, 1] }, scale: { duration: 7, ease: "linear" } }}
            onError={() => { failed.current.add(i); go(1); }}
          />
        </AnimatePresence>
      </motion.div>

      {/* Feathered scrims: text side stays dark, edges fade out softly, bottom melts into the page */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, hsl(var(--wow-ink) / 0.94) 0%, hsl(var(--wow-ink) / 0.78) 38%, hsl(var(--wow-ink) / 0.25) 70%, hsl(var(--wow-ink) / 0.1) 100%)," +
            "radial-gradient(120% 90% at 80% 45%, transparent 35%, hsl(var(--wow-ink) / 0.55) 100%)," +
            "linear-gradient(180deg, hsl(var(--wow-ink) / 0.35) 0%, transparent 18%, transparent 72%, hsl(var(--wow-ink)) 100%)",
        }}
      />
      <div aria-hidden="true" className="absolute inset-0 md:hidden pointer-events-none" style={{ background: "hsl(var(--wow-ink) / 0.45)" }} />

      {/* Dots, spider web and ripples on top of the photo */}
      <InteractiveDotGrid />

      {/* Copy */}
      <div className="relative mx-auto max-w-7xl w-full px-6 pt-16 pb-28 sm:py-28 lg:px-8 lg:py-36">
        <div className="max-w-4xl">
          <h1 className="text-xs font-medium uppercase tracking-[0.2em] wow-text-muted mb-6 sm:mb-8">
            AI agents for small businesses
          </h1>

          <div className="min-h-[12rem] sm:min-h-[15rem] lg:min-h-[17rem]" aria-live="off">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={scene.id} {...textIn} transition={reduce ? { duration: 0.3 } : SPRING}>
                <p className="text-lg sm:text-2xl mb-4 opacity-85">{scene.moment}</p>
                <p className="font-display font-normal tracking-[-0.02em] leading-[1.04] text-[clamp(2rem,4.6vw,4.25rem)] text-balance">
                  {scene.line}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-6 sm:mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4">
            <MagneticButton>
              <Link
                to="/agent"
                className="group inline-flex items-center justify-center rounded-md wow-bg-indigo px-8 py-4 text-base font-medium wow-text-paper transition-transform duration-200 wow-ease hover:-translate-y-[1px] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--wow-ink))]"
              >
                See it work
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-0.5" />
              </Link>
            </MagneticButton>
            <MagneticButton>
              <a
                href="tel:+12136410074"
                className="inline-flex items-center justify-center rounded-md border wow-border bg-[hsl(var(--wow-ink)/0.35)] backdrop-blur-md px-8 py-4 text-base font-medium wow-text-paper transition-colors duration-200 wow-ease hover:wow-bg-elev active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--wow-indigo-light))]"
              >
                Try her now: <span className="ml-1.5 whitespace-nowrap">{PHONE}</span>
              </a>
            </MagneticButton>
          </div>

          {/* Scene controls: counter, 6-second progress, previous / pause / next */}
          <div className="mt-12 flex items-center gap-3 text-sm wow-text-muted">
            <span className="tabular-nums whitespace-nowrap w-[4.5rem]">
              {String(i + 1).padStart(2, "0")} / {total}
            </span>
            <div className="relative h-[3px] w-28 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
              {running && (
                <motion.div
                  key={`${i}-${progressKey}`}
                  className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--wow-indigo-light))]"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: INTERVAL_MS / 1000, ease: "linear" }}
                />
              )}
            </div>
            <button type="button" onClick={() => go(-1)} aria-label="Previous example" className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 active:scale-[0.94] transition">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {(
              <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play examples" : "Pause examples"} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 active:scale-[0.94] transition">
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
            )}
            <button type="button" onClick={() => go(1)} aria-label="Next example" className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 active:scale-[0.94] transition">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-sm wow-text-muted">
            {heroPills.map((pill, n) => (
              <span key={pill} className="inline-flex items-center gap-2">
                {n > 0 && <span aria-hidden="true" className="opacity-40">·</span>}
                {pill}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
