import { useEffect, useRef } from "react";

/**
 * Slow concentric orbits. Multiple thin rings at different sizes,
 * rotating around an off-center anchor that drifts toward the cursor.
 * Calm, restrained, suitable for contact / about pages.
 *
 * Original Bestly work, Canvas 2D.
 */

export function OrbitsBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const cursor = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let anchorX = 0;
    let anchorY = 0;
    let targetAnchorX = 0;
    let targetAnchorY = 0;

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      anchorX = width * 0.65;
      anchorY = height * 0.5;
      targetAnchorX = anchorX;
      targetAnchorY = anchorY;
    }

    function frame(t: number) {
      // Anchor follows cursor target with heavy easing
      targetAnchorX = width * 0.65 + (cursor.current.x - 0.5) * width * 0.18;
      targetAnchorY = height * 0.5 + (cursor.current.y - 0.5) * height * 0.18;
      anchorX += (targetAnchorX - anchorX) * 0.04;
      anchorY += (targetAnchorY - anchorY) * 0.04;

      ctx.clearRect(0, 0, width, height);

      // 7 rings, alternating direction, varied sizes
      const rings = 7;
      const baseR = Math.min(width, height) * 0.28;
      for (let i = 0; i < rings; i++) {
        const r = baseR + i * 70 + Math.sin(t * 0.0003 + i) * 4;
        const angle = (t * 0.00012 * (i % 2 === 0 ? 1 : -1)) + i * 0.4;
        ctx.save();
        ctx.translate(anchorX, anchorY);
        ctx.rotate(angle);
        // Indigo rings, alpha falls off with index
        const alpha = Math.max(0.04, 0.18 - i * 0.02);
        ctx.strokeStyle = `hsla(230, 64%, ${68 - i * 4}%, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        // A small bright dot orbiting on each ring
        const dotAngle = t * 0.0006 * (i % 2 === 0 ? 1 : -1) + i;
        const dx = Math.cos(dotAngle) * r;
        const dy = Math.sin(dotAngle) * r * 0.55;
        ctx.fillStyle = `hsla(230, 64%, 78%, ${0.6 - i * 0.06})`;
        ctx.beginPath();
        ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (!reduce) rafRef.current = requestAnimationFrame(frame);
    }

    function onMove(e: PointerEvent) {
      cursor.current.x = e.clientX / window.innerWidth;
      cursor.current.y = e.clientY / window.innerHeight;
    }

    resize();
    if (reduce) frame(0);
    else rafRef.current = requestAnimationFrame(frame);

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    const onVis = () => {
      if (document.hidden && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (!document.hidden && !reduce && rafRef.current === null) {
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
