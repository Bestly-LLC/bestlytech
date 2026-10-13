/**
 * Leo's orb, shared by the hero (DeliveryLeo) and the docked mini Leo (LeoDock). One look, one place to tune it.
 *
 *  OrbFace      the swirl: two layers of soft orange blobs turning in opposite directions (14s and 22s) inside the circle, plus a
 *               fixed shading layer on top, so the surface looks like it is slowly flowing. Transform only (GPU).
 *  OrbGlow      the halo behind it: a radial gradient that fades to nothing, so it has no edge, breathing every 4s.
 *  useOrbReact  Leo's voice (or the guest's mic) pushes the orb and halo a little, written straight to the elements (no re-render).
 *  springEase   an Apple-style spring (damping and response) as a CSS linear() easing, with a cubic-bezier fallback.
 *  useStaged    mount, then animate in; animate out, then unmount. Lets a spring play in both directions.
 * Reduce Motion: no turning, no breathing, no scale. The halo is just there, soft.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { useLeoSession } from "./useLeoSession";

type Sess = ReturnType<typeof useLeoSession>;

export const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The orb's moving surface. Put it inside a `.dl-orb` (position: relative; border-radius: 50%). */
export function OrbFace() {
  return (
    <span aria-hidden className="dl-face">
      <span className="dl-swirl dl-swirl-a" />
      <span className="dl-swirl dl-swirl-b" />
      <span className="dl-shade" />
    </span>
  );
}

/** The soft halo. `mode` picks the breathing: idle (4s), wait (fast, while connecting) or live (none: the voice drives it). */
export const OrbGlow = ({ glowRef, mode, mini }: { glowRef?: RefObject<HTMLSpanElement>; mode: "idle" | "wait" | "live"; mini?: boolean }) => (
  <span ref={glowRef} aria-hidden className={`dl-glow ${mini ? "dl-glow-mini" : ""} ${mode === "idle" ? "dl-glow-idle" : mode === "wait" ? "dl-glow-wait" : ""}`} />
);

/** Orb and halo follow the volume: Leo's voice while he talks, the guest's mic while Leo listens. Smoothed, scale only. */
export function useOrbReact(sess: Sess, orb: RefObject<HTMLElement>, glow: RefObject<HTMLElement>, live: boolean, depth = 1) {
  const cur = useRef(sess); cur.current = sess; // read per frame, so the effect doesn't restart on every render
  useEffect(() => {
    const o = orb.current, g = glow.current;
    if (!o || !g) return;
    if (!live) { o.style.transform = ""; g.style.transform = ""; g.style.opacity = ""; return; }
    const calm = reducedMotion();
    let raf = 0, v = 0;
    const tick = () => {
      const c = cur.current, l = c.levels();
      const target = Math.min(1, Math.max(0, c.speaking ? l.out * 1.6 : c.voice && !c.muted ? l.in * 1.1 : 0));
      v += (target - v) * 0.22; // smoothing: rises quickly, settles softly
      if (calm) { g.style.opacity = String(0.8 + v * 0.2); }
      else {
        o.style.transform = `scale(${(1 + v * 0.13 * depth).toFixed(4)})`;
        g.style.transform = `scale(${(0.98 + v * 0.28).toFixed(4)})`;
        g.style.opacity = String(Math.min(1, 0.78 + v * 0.3).toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, orb, glow, depth]);
}

/**
 * Apple's spring as a CSS easing. `damping` 1 = no overshoot, below 1 bounces; `response` is how fast it gets there, in seconds.
 * Sampled into linear(); a browser without linear() gets a gentle cubic-bezier with a tiny overshoot instead.
 */
export function springEase(damping = 0.8, response = 0.42): string {
  if (typeof CSS === "undefined" || !CSS.supports?.("transition-timing-function", "linear(0, 1)")) return "cubic-bezier(.34, 1.28, .64, 1)";
  const w = (2 * Math.PI) / response, z = Math.min(damping, 0.999), wd = w * Math.sqrt(1 - z * z);
  const settle = 4 / (z * w); // time to ~2%
  const pts: string[] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * settle;
    const y = 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
    pts.push((i === N ? 1 : y).toFixed(4));
  }
  return `linear(${pts.join(", ")})`;
}
/** How long that spring takes to settle, in ms (for the CSS transition duration). */
export const springMs = (damping = 0.8, response = 0.42) => Math.round((4 / (Math.min(damping, 0.999) * ((2 * Math.PI) / response))) * 1000);

/**
 * Enter and exit that can both be animated. `show` true: mount now, flip `entered` on the next frame (the spring plays).
 * `show` false: flip `entered` off, unmount after `ms` (the exit plays). Flipping back mid-exit just re-enters from where it is.
 */
export function useStaged(show: boolean, ms = 320) {
  const [mounted, setMounted] = useState(show);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let t = 0, r1 = 0, r2 = 0;
    if (show) {
      setMounted(true);
      r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setEntered(true)); });
    } else {
      setEntered(false);
      t = window.setTimeout(() => setMounted(false), ms);
    }
    return () => { window.clearTimeout(t); cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [show, ms]);
  return { mounted, entered };
}
