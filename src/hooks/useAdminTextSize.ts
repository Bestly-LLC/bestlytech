import { useCallback, useEffect, useState } from "react";

/**
 * Admin text size. Every admin size is rem-based, so changing the root font size scales text,
 * icons, spacing and graphics together (like Safari's page zoom, but only inside /admin).
 * The choice is remembered per browser; the public site keeps its own 16px base.
 */
const STEPS = [12, 13, 14, 15, 16, 17, 18] as const;
const DEFAULT_PX = 14;
const KEY = "bestly.admin.textSize";

function readStored(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (STEPS as readonly number[]).includes(v) ? v : DEFAULT_PX;
  } catch {
    return DEFAULT_PX;
  }
}

export function useAdminTextSize() {
  const [px, setPx] = useState<number>(readStored);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = `${px}px`;
    try {
      localStorage.setItem(KEY, String(px));
    } catch {
      /* private mode: size still applies for this visit */
    }
    return () => {
      root.style.fontSize = previous;
    };
  }, [px]);

  const index = (STEPS as readonly number[]).indexOf(px);
  const smaller = useCallback(() => setPx((p) => STEPS[Math.max(0, (STEPS as readonly number[]).indexOf(p) - 1)]), []);
  const larger = useCallback(() => setPx((p) => STEPS[Math.min(STEPS.length - 1, (STEPS as readonly number[]).indexOf(p) + 1)]), []);
  const reset = useCallback(() => setPx(DEFAULT_PX), []);

  return {
    percent: Math.round((px / 16) * 100),
    canShrink: index > 0,
    canGrow: index < STEPS.length - 1,
    isDefault: px === DEFAULT_PX,
    smaller,
    larger,
    reset,
  };
}
