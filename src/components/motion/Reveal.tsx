import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DURATION, EASE } from "@/lib/motion";

/**
 * Reveal — scroll-into-view entrance with reduced-motion safety.
 * Drop-in replacement for ad-hoc AnimatedSection usage on cloud surfaces.
 * Under prefers-reduced-motion it renders a plain, fully-visible div.
 */
interface RevealProps {
  children: ReactNode;
  className?: string;
  /** seconds to delay the entrance */
  delay?: number;
  /** how much of the element must be visible before firing (0-1) */
  amount?: number;
  /** vertical offset in px the element rises from */
  y?: number;
}

export function Reveal({
  children,
  className,
  delay = 0,
  amount = 0.2,
  y = 16,
}: RevealProps) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount }}
      transition={{ duration: DURATION.slow, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
