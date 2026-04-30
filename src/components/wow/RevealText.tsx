import { type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

const HOUSE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Word-by-word reveal that triggers when the element scrolls into view.
 * Splits children string by spaces. Re-runs once per page load.
 *
 * Wrapping line: <RevealText className="font-display ...">Some headline.</RevealText>
 */
export function RevealText({
  children,
  className = "",
  as: Tag = "span",
  delay = 0,
}: {
  children: string;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const words = children.split(/\s+/);

  return (
    <Tag className={className}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          className="inline-block mr-[0.22em]"
          initial={reduce ? false : { opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10% 0px" }}
          transition={{
            duration: 0.55,
            delay: reduce ? 0 : delay + 0.06 * i,
            ease: HOUSE_EASE,
          }}
        >
          {word}
        </motion.span>
      ))}
    </Tag>
  );
}

/**
 * Reveal-on-scroll wrapper — opacity + y rise as the child enters viewport.
 */
export function RevealOnScroll({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8% 0px" }}
      transition={{ duration: 0.6, delay, ease: HOUSE_EASE }}
    >
      {children}
    </motion.div>
  );
}
