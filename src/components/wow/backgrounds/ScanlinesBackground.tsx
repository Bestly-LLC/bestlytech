import { useEffect, useRef } from "react";

/**
 * Animated vertical-scanlines background. Thin indigo bars sweep
 * horizontally across the viewport at varying speeds and opacities.
 * Reads as "infrastructure" / "data flow" — appropriate for the
 * services + cloud pages.
 *
 * Original Bestly work, Canvas 2D.
 */

type Bar = { x: number; speed: number; width: number; opacity: number };

export function ScanlinesBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const cursorXRef = useRef(0.5);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let bars: Bar[] = [];

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Build bars: enough to feel busy without being noisy
      const count = 12;
      bars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        speed: 20 + Math.random() * 60, // px/sec
        width: 1 + Math.random() * 2,
        opacity: 0.06 + Math.random() * 0.18,
      }));
    }

    let lastT = performance.now();

    function frame(t: number) {
      const dt = Math.min(60, t - lastT);
      lastT = t;
      ctx.clearRect(0, 0, width, height);
      // Cursor influences global bar tint slightly
      const cursorBoost = 1 + cursorXRef.current * 0.3;

      for (const b of bars) {
        if (!reduce) b.x += (b.speed * dt) / 1000;
        if (b.x > width + 20) {
          b.x = -20;
          b.opacity = 0.06 + Math.random() * 0.18;
          b.speed = 20 + Math.random() * 60;
          b.width = 1 + Math.random() * 2;
        }
        // Vertical bar with a soft falloff at top + bottom
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        const indigo = `hsla(230, 64%, 68%, ${b.opacity * cursorBoost})`;
        grad.addColorStop(0, "transparent");
        grad.addColorStop(0.2, indigo);
        grad.addColorStop(0.8, indigo);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.fillRect(b.x, 0, b.width, height);
      }

      if (!reduce) rafRef.current = requestAnimationFrame(frame);
    }

    function onMove(e: PointerEvent) {
      cursorXRef.current = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
    }

    resize();
    if (reduce) frame(performance.now());
    else rafRef.current = requestAnimationFrame(frame);

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    const onVis = () => {
      if (document.hidden && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (!document.hidden && !reduce && rafRef.current === null) {
        lastT = performance.now();
        rafRef.current = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
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
