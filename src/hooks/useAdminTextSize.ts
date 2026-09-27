import { useCallback, useEffect, useState } from "react";

/**
 * Admin text size. Every admin size is rem-based, so changing the root font size scales text,
 * icons, spacing and graphics together (like Safari's page zoom, but only inside /admin).
 *
 * Phone and desktop are separate, because Apple's defaults are: iOS body text is 17pt, macOS is 13pt.
 * - Phone (narrow screen): "Auto" by default. CSS sets the root to 17px, and on iPhone Safari to
 *   `-apple-system-body`, so the admin follows the iPhone's own Text Size setting (Dynamic Type).
 * - Desktop: 14px by default, as before.
 * Picking a size with − / + stores a fixed size for that kind of screen; Reset goes back to the default.
 */
const STEPS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 22] as const;
const DESKTOP_DEFAULT = 14;
const PHONE_AUTO = 17; // what "Auto" is on a phone before Dynamic Type adjusts it
const DESKTOP_KEY = "bestly.admin.textSize";
const PHONE_KEY = "bestly.admin.textSize.phone";
const PHONE_QUERY = "(max-width: 767px)";

const isPhone = () => typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches === true;

function readStored(phone: boolean): number | null {
  try {
    const v = Number(localStorage.getItem(phone ? PHONE_KEY : DESKTOP_KEY));
    if ((STEPS as readonly number[]).includes(v)) return v;
  } catch {
    /* private mode */
  }
  return phone ? null : DESKTOP_DEFAULT;
}

/** Nearest step to a measured size, so − / + work from Auto. */
function nearestStep(px: number) {
  return STEPS.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a), STEPS[0] as number);
}

export function useAdminTextSize() {
  const [phone, setPhone] = useState(isPhone);
  // null = Auto (phones only): no inline size, CSS decides.
  const [px, setPx] = useState<number | null>(() => readStored(isPhone()));

  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return;
    const onChange = () => {
      setPhone(mq.matches);
      setPx(readStored(mq.matches));
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = px == null ? "" : `${px}px`;
    try {
      const key = phone ? PHONE_KEY : DESKTOP_KEY;
      if (px == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(px));
    } catch {
      /* private mode: size still applies for this visit */
    }
    return () => {
      root.style.fontSize = previous;
    };
  }, [px, phone]);

  const current = () => px ?? nearestStep(parseFloat(getComputedStyle(document.documentElement).fontSize) || PHONE_AUTO);
  const effective = px ?? PHONE_AUTO;
  const index = (STEPS as readonly number[]).indexOf(px ?? nearestStep(effective));
  const smaller = useCallback(() => setPx(() => STEPS[Math.max(0, (STEPS as readonly number[]).indexOf(current()) - 1)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [px]);
  const larger = useCallback(() => setPx(() => STEPS[Math.min(STEPS.length - 1, (STEPS as readonly number[]).indexOf(current()) + 1)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [px]);
  const reset = useCallback(() => setPx(phone ? null : DESKTOP_DEFAULT), [phone]);

  return {
    /** "Auto" on a phone that follows the iPhone text size, otherwise a percentage of 16px. */
    label: px == null ? "Auto" : `${Math.round((px / 16) * 100)}%`,
    percent: Math.round((effective / 16) * 100),
    canShrink: index > 0,
    canGrow: index < STEPS.length - 1,
    isDefault: phone ? px == null : px === DESKTOP_DEFAULT,
    smaller,
    larger,
    reset,
  };
}
