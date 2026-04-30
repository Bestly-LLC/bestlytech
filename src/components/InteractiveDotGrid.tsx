import { useEffect, useRef } from "react";

/**
 * Original interactive dot-grid background for the Bestly hero.
 *
 * - Dense indigo dot grid spaced ~28px on a square lattice.
 * - Each dot has a base radius and brightness; both ramp up smoothly
 *   based on distance from the cursor (≤ ~200px radius of influence).
 * - At rest, a low-frequency 2D sin field drives perpetual subtle drift
 *   so the surface is never fully static.
 * - Every 4–7 seconds, a ripple emanates from a random origin and rolls
 *   across the grid as a thin radial brightness pulse.
 * - When the cursor is near, hairline strokes connect dots that are both
 *   bright enough — a "network" effect that hints at the data-grid
 *   metaphor without going full particle-soup.
 *
 * Performance:
 * - Canvas 2D, no Three.js.
 * - Pixel ratio capped at 2.
 * - Pauses when tab is hidden.
 * - Renders one static frame and stops under prefers-reduced-motion.
 *
 * Original Bestly work — no third-party design lifted.
 */

type Dot = {
  x: number;
  y: number;
  /** Phase offset for at-rest drift, [0, 2π) */
  phase: number;
};

type Ripple = {
  /** Origin in canvas pixels */
  ox: number;
  oy: number;
  /** Time started, ms (perf.now) */
  start: number;
  /** Lifespan in ms */
  duration: number;
  /** Max radius in canvas pixels */
  maxR: number;
};

const SPACING = 28;
const CURSOR_RADIUS = 200;
const CURSOR_RADIUS_SQ = CURSOR_RADIUS * CURSOR_RADIUS;
const BASE_RADIUS = 0.6;
const MAX_RADIUS = 3.2;
const BASE_ALPHA = 0.16;
const MAX_ALPHA = 1.0;
const CONNECTION_RADIUS_SQ = 60 * 60;
const CONNECTION_THRESHOLD = 0.55;

export function InteractiveDotGrid() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorRef = useRef({ x: -10000, y: -10000 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let dots: Dot[] = [];
    let ripples: Ripple[] = [];
    let nextRippleAt = 0;

    function buildGrid() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots = [];
      const cols = Math.ceil(width / SPACING) + 2;
      const rows = Math.ceil(height / SPACING) + 2;
      const offsetX = (width - (cols - 1) * SPACING) / 2;
      const offsetY = (height - (rows - 1) * SPACING) / 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots.push({
            x: offsetX + c * SPACING,
            y: offsetY + r * SPACING,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    function spawnRipple(t: number) {
      ripples.push({
        ox: Math.random() * width,
        oy: Math.random() * height,
        start: t,
        duration: 2400,
        maxR: Math.max(width, height) * 0.7,
      });
      nextRippleAt = t + 4000 + Math.random() * 3000;
    }

    function rippleIntensity(dot: Dot, t: number): number {
      let total = 0;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        const age = t - r.start;
        if (age > r.duration) {
          ripples.splice(i, 1);
          continue;
        }
        const progress = age / r.duration;
        const radius = r.maxR * progress;
        const dx = dot.x - r.ox;
        const dy = dot.y - r.oy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Thin radial pulse: peak when dot's distance ≈ ripple's current radius
        const ringWidth = 60;
        const proximity = Math.max(0, 1 - Math.abs(dist - radius) / ringWidth);
        // Decay over the ripple's lifespan
        const decay = 1 - progress;
        total += proximity * decay;
      }
      return Math.min(total, 1);
    }

    let t0 = performance.now();

    function frame(t: number) {
      // Maybe spawn a new ripple
      if (!reduce && t > nextRippleAt) spawnRipple(t);

      ctx.clearRect(0, 0, width, height);

      const cursorX = cursorRef.current.x;
      const cursorY = cursorRef.current.y;
      const driftPhase = (t - t0) * 0.0009;

      // Pre-compute intensities so we can do a separate connection pass
      const intensities = new Float32Array(dots.length);
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const dx = d.x - cursorX;
        const dy = d.y - cursorY;
        const dsq = dx * dx + dy * dy;
        let cursorBoost = 0;
        if (dsq < CURSOR_RADIUS_SQ) {
          const f = 1 - dsq / CURSOR_RADIUS_SQ;
          cursorBoost = f * f; // ease-out
        }
        const drift = reduce ? 0 : Math.sin(driftPhase + d.phase) * 0.15 + 0.15;
        const ripple = reduce ? 0 : rippleIntensity(d, t) * 0.85;
        intensities[i] = Math.min(1, cursorBoost + drift + ripple * 0.6);
      }

      // Draw dots
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const ix = intensities[i];
        const radius = BASE_RADIUS + (MAX_RADIUS - BASE_RADIUS) * ix;
        const alpha = BASE_ALPHA + (MAX_ALPHA - BASE_ALPHA) * ix;
        // hsl(var(--wow-indigo-light)) ≈ #7a8be0 → 230 64% 68%
        // We blend toward warmer indigo as intensity peaks for visual punch.
        const hue = 230;
        const sat = 64 - ix * 8;
        const light = 60 + ix * 20;
        ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Connection pass: only near cursor, only between bright-enough neighbors
      if (cursorX > -1000) {
        ctx.lineWidth = 0.5;
        for (let i = 0; i < dots.length; i++) {
          if (intensities[i] < CONNECTION_THRESHOLD) continue;
          const a = dots[i];
          const dxc = a.x - cursorX;
          const dyc = a.y - cursorY;
          if (dxc * dxc + dyc * dyc > CURSOR_RADIUS_SQ) continue;
          for (let j = i + 1; j < dots.length; j++) {
            if (intensities[j] < CONNECTION_THRESHOLD) continue;
            const b = dots[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dsq = dx * dx + dy * dy;
            if (dsq > CONNECTION_RADIUS_SQ) continue;
            const strength = Math.min(intensities[i], intensities[j]);
            ctx.strokeStyle = `hsla(230, 64%, 78%, ${strength * 0.4})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      if (!reduce) {
        rafRef.current = requestAnimationFrame(frame);
      }
    }

    function onPointerMove(e: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      cursorRef.current.x = e.clientX - rect.left;
      cursorRef.current.y = e.clientY - rect.top;
    }
    function onPointerLeave() {
      cursorRef.current.x = -10000;
      cursorRef.current.y = -10000;
    }
    function onResize() {
      buildGrid();
    }
    function onVisibility() {
      if (document.hidden && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (!document.hidden && !reduce && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(frame);
      }
    }

    buildGrid();
    nextRippleAt = performance.now() + 1500; // first ripple soon after load
    if (reduce) {
      frame(performance.now());
    } else {
      rafRef.current = requestAnimationFrame(frame);
    }

    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
