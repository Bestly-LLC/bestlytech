import { useEffect, useRef } from "react";

/**
 * Original interactive mesh-gradient background for the Bestly hero.
 *
 * Six colored blobs drift on a slow noise loop. The cursor (or touch)
 * gently parallaxes them, weighted by depth. No external deps — pure
 * Canvas 2D — so the bundle stays lean and there's no GPU demand
 * beyond `filter: blur`.
 *
 * - Respects `prefers-reduced-motion` (renders a static frame, no rAF).
 * - Pauses when offscreen to save battery.
 * - Pointer events pass through (`pointer-events: none`).
 *
 * Original Bestly work — no third-party design lifted.
 */
type Blob = {
  baseX: number;
  baseY: number;
  radius: number;
  color: string;
  driftSpeed: number;
  driftPhase: number;
  driftAmp: number;
  parallax: number;
};

const COLORS = [
  "rgba(58, 74, 156, 0.55)",   // indigo fill
  "rgba(122, 139, 224, 0.35)", // indigo light
  "rgba(26, 39, 102, 0.55)",   // indigo deep
  "rgba(122, 139, 224, 0.20)", // light wash
  "rgba(58, 74, 156, 0.30)",   // mid wash
  "rgba(20, 20, 20, 0.0)",     // anchor (transparent)
];

export function InteractiveMeshBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef({ x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;

    const blobs: Blob[] = [];
    function rebuildBlobs() {
      blobs.length = 0;
      const cx = width / 2;
      const cy = height / 2;
      const max = Math.max(width, height);
      // 6 blobs, varied radii, varied parallax depths
      const seeds = [
        { offX: -0.25, offY: -0.18, radius: 0.55, parallax: 0.06, drift: 0.0006, amp: 0.08 },
        { offX:  0.22, offY: -0.35, radius: 0.42, parallax: 0.04, drift: 0.0009, amp: 0.07 },
        { offX:  0.35, offY:  0.22, radius: 0.50, parallax: 0.09, drift: 0.0005, amp: 0.10 },
        { offX: -0.32, offY:  0.30, radius: 0.45, parallax: 0.07, drift: 0.0007, amp: 0.09 },
        { offX:  0.05, offY: -0.05, radius: 0.30, parallax: 0.12, drift: 0.0011, amp: 0.06 },
        { offX:  0.0,  offY:  0.0,  radius: 0.65, parallax: 0.02, drift: 0.0003, amp: 0.04 },
      ];
      seeds.forEach((s, i) => {
        blobs.push({
          baseX: cx + s.offX * max,
          baseY: cy + s.offY * max,
          radius: s.radius * max * 0.5,
          color: COLORS[i % COLORS.length],
          driftSpeed: s.drift,
          driftPhase: Math.random() * Math.PI * 2,
          driftAmp: s.amp * max,
          parallax: s.parallax,
        });
      });
    }

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuildBlobs();
    }

    function draw(t: number) {
      // Smooth cursor follow
      pointerRef.current.x += (pointerRef.current.targetX - pointerRef.current.x) * 0.04;
      pointerRef.current.y += (pointerRef.current.targetY - pointerRef.current.y) * 0.04;
      const cursorOffsetX = (pointerRef.current.x - 0.5) * width;
      const cursorOffsetY = (pointerRef.current.y - 0.5) * height;

      ctx.clearRect(0, 0, width, height);
      // Composite mode for soft blending of blobs
      ctx.globalCompositeOperation = "lighter";

      blobs.forEach((b) => {
        const dx = Math.cos(b.driftPhase + t * b.driftSpeed) * b.driftAmp;
        const dy = Math.sin(b.driftPhase + t * b.driftSpeed * 0.8) * b.driftAmp;
        const px = b.baseX + dx + cursorOffsetX * b.parallax;
        const py = b.baseY + dy + cursorOffsetY * b.parallax;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, b.radius);
        grad.addColorStop(0, b.color);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(px - b.radius, py - b.radius, b.radius * 2, b.radius * 2);
      });

      ctx.globalCompositeOperation = "source-over";

      if (!reduce) {
        rafRef.current = requestAnimationFrame(draw);
      }
    }

    function onPointerMove(e: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current.targetX = (e.clientX - rect.left) / rect.width;
      pointerRef.current.targetY = (e.clientY - rect.top) / rect.height;
    }

    function onPointerLeave() {
      pointerRef.current.targetX = 0.5;
      pointerRef.current.targetY = 0.5;
    }

    resize();
    if (reduce) {
      // Render one static frame and stop
      draw(0);
    } else {
      rafRef.current = requestAnimationFrame(draw);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);

    // Pause when tab hidden
    const onVisibility = () => {
      if (document.hidden && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } else if (!document.hidden && !reduce && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
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
      style={{ filter: "blur(40px) saturate(1.1)" }}
    />
  );
}
