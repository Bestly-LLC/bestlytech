import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/motion";

/**
 * AnimatedNumber — smoothly rolls from its previous value to the next
 * whenever `value` changes (e.g. the pricing calculator savings figure).
 * `format` handles rounding/currency so intermediate floats never leak.
 * Reduced-motion snaps straight to the value.
 */
export function AnimatedNumber({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(display, value, {
      duration: 0.6,
      ease: EASE,
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
    // display intentionally omitted so we animate from the live previous value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce]);

  return <>{format(display)}</>;
}
