import type { Transition, Variants } from "framer-motion";

/**
 * Shared motion vocabulary for the client-facing cloud surfaces.
 * One set of easings + durations so every animation across the funnel
 * shares the same rhythm (see docs/cloud-wow-opusplan.md, Phase 1).
 *
 * House rules: transform/opacity only, ease-out entering, exits faster
 * than enters, micro-interactions 150-300ms. Always pair with
 * useReducedMotion so motion can be disabled wholesale.
 */

// Standard cubic-bezier (matches the existing tailwind fade-in keyframes).
export const EASE = [0.25, 0.1, 0.25, 1] as const;
// Expressive ease-out for entrances that should feel like they "arrive".
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const DURATION = {
  fast: 0.18,
  base: 0.4,
  slow: 0.6,
} as const;

export const SPRING: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 0.9,
};

export const SPRING_SOFT: Transition = {
  type: "spring",
  stiffness: 140,
  damping: 22,
};

export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: DURATION.slow, ease: EASE },
  },
};

export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.05 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(3px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.5, ease: EASE },
  },
};
