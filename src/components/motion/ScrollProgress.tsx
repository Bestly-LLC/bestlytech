import { motion, useScroll, useSpring, useReducedMotion } from "framer-motion";

/**
 * ScrollProgress — a thin gradient bar pinned to the top of the viewport
 * that fills as the page scrolls. Uses the brand gradient. Hidden entirely
 * under prefers-reduced-motion.
 */
export function ScrollProgress() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  if (reduce) return null;

  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="fixed left-0 top-0 z-50 h-[3px] w-full origin-left gradient-bg"
    />
  );
}
