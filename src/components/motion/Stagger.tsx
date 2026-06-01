import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { staggerItem } from "@/lib/motion";

/**
 * Stagger / StaggerItem — sequence a grid or list into view 45ms apart.
 * Wrap the container in <Stagger> and each child in <StaggerItem>.
 * Reduced-motion renders plain divs with no animation.
 */

interface StaggerProps {
  children: ReactNode;
  className?: string;
  amount?: number;
  /** seconds between each child's entrance */
  gap?: number;
}

export function Stagger({ children, className, amount = 0.2, gap = 0.045 }: StaggerProps) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: 0.05 } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  );
}
