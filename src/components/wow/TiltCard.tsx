import { useRef, type ReactNode, type MouseEvent } from "react";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion";

/**
 * 3D tilt — child rotates ≤ 6° on each axis based on cursor position.
 * Springy return to flat on leave. Disabled on touch + reduced motion.
 */
export function TiltCard({
  children,
  className = "",
  max = 6,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rx = useTransform(py, [-0.5, 0.5], [max, -max]);
  const ry = useTransform(px, [-0.5, 0.5], [-max, max]);
  const srx = useSpring(rx, { stiffness: 180, damping: 16 });
  const sry = useSpring(ry, { stiffness: 180, damping: 16 });

  function move(e: MouseEvent<HTMLDivElement>) {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width - 0.5);
    py.set((e.clientY - rect.top) / rect.height - 0.5);
  }
  function leave() {
    px.set(0);
    py.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={move}
      onMouseLeave={leave}
      style={{
        rotateX: srx,
        rotateY: sry,
        transformStyle: "preserve-3d",
        transformPerspective: 800,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
