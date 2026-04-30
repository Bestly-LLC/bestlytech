import { useEffect, useRef } from "react";

/**
 * Drifting particles that connect with hairlines when within range.
 * Cursor exerts a soft repulsion field. Reads as "network" / "graph".
 *
 * Original Bestly work, Canvas 2D.
 */

type Particle = { x: number; y: number; vx: number; vy: number };

const PARTICLE_COUNT = 80;
const CONNECT_DIST = 130;
const CURSOR_REPULSE = 90;

export function ParticleNetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const cursor = useRef({ x: -10000, y: -10000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];

    function resize() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
      }));
    }

    let lastT = performance.now();

    function frame(t: number) {
      const dt = Math.min(60, t - lastT);
      lastT = t;
      ctx.clearRect(0, 0, width, height);

      const cx = cursor.current.x;
      const cy = cursor.current.y;

      // Update particles
      for (const p of particles) {
        if (!reduce) {
          p.x += p.vx * dt * 0.06;
          p.y += p.vy * dt * 0.06;
        }
        // Edge wrap
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;
        // Cursor repulse
        const dxc = p.x - cx;
        const dyc = p.y - cy;
        const dsq = dxc * dxc + dyc * dyc;
        if (dsq < CURSOR_REPULSE * CURSOR_REPULSE) {
          const d = Math.sqrt(dsq) || 1;
          const f = (1 - d / CURSOR_REPULSE) * 0.6;
          p.vx += (dxc / d) * f;
          p.vy += (dyc / d) * f;
        }
        // Soft damping so velocities don't blow up
        p.vx *= 0.96;
        p.vy *= 0.96;
        // Floor velocity so they keep drifting
        const speed = Math.hypot(p.vx, p.vy);
        if (speed < 0.05) {
          p.vx += (Math.random() - 0.5) * 0.1;
          p.vy += (Math.random() - 0.5) * 0.1;
        }
      }

      // Connections
      ctx.lineWidth = 0.6;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dsq = dx * dx + dy * dy;
          if (dsq < CONNECT_DIST * CONNECT_DIST) {
            const alpha = (1 - Math.sqrt(dsq) / CONNECT_DIST) * 0.35;
            ctx.strokeStyle = `hsla(230, 64%, 78%, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Particles
      for (const p of particles) {
        ctx.fillStyle = "hsla(230, 64%, 78%, 0.65)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduce) rafRef.current = requestAnimationFrame(frame);
    }

    function onMove(e: PointerEvent) {
      cursor.current.x = e.clientX;
      cursor.current.y = e.clientY;
    }
    function onLeave() {
      cursor.current.x = -10000;
      cursor.current.y = -10000;
    }

    resize();
    if (reduce) frame(performance.now());
    else rafRef.current = requestAnimationFrame(frame);

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
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
      window.removeEventListener("pointerleave", onLeave);
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
