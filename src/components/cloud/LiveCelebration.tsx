import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * LiveCelebration — a one-shot burst of light when a customer's cloud goes
 * live (Stage 8 of the funnel). Fires exactly once per deal per session, so
 * the 60s status auto-refresh never replays it. Disabled under
 * prefers-reduced-motion. Mounts inside a `position: relative` container.
 */
export function LiveCelebration({ dealId }: { dealId: string }) {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (reduce) return;
    const key = `bestly-live-celebrated-${dealId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage unavailable — still celebrate this mount */
    }
    setShow(true);
    const t = setTimeout(() => setShow(false), 1900);
    return () => clearTimeout(t);
  }, [dealId, reduce]);

  const particles = useMemo(
    () =>
      Array.from({ length: 28 }).map((_, i) => {
        const angle = (Math.PI * 2 / 28) * i + (i % 2 ? 0.11 : 0);
        const dist = 120 + (i % 5) * 28;
        return {
          x: Math.round(Math.cos(angle) * dist),
          y: Math.round(Math.sin(angle) * dist),
          delay: (i % 6) * 0.04,
          size: 4 + (i % 3) * 2,
        };
      }),
    []
  );

  if (!show) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-10 z-20 h-0 w-0">
      {particles.map((p, i) => (
        <span
          key={i}
          className="cloud-burst absolute rounded-full"
          style={{
            ["--bx" as string]: `${p.x}px`,
            ["--by" as string]: `${p.y}px`,
            width: p.size,
            height: p.size,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            background: "hsl(var(--glow-color))",
            boxShadow: "0 0 8px hsl(var(--glow-color))",
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
