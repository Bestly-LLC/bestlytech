import { motion, useScroll, useSpring } from "framer-motion";

/**
 * 1px indigo hairline at top of viewport that tracks page scroll progress.
 * Sticky-positioned, zero layout impact.
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 220, damping: 30, mass: 0.2 });

  return (
    <motion.div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-[1px] origin-left z-[60]"
      style={{
        scaleX,
        background: "hsl(var(--wow-indigo-light))",
      }}
    />
  );
}
