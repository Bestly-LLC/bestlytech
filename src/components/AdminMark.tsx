import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * The admin mark: binoculars giving side-eye.
 *
 * Inline SVG (not <img>) so it paints instantly and its animation can be phase-locked:
 * every copy starts at the same point in the cycle, counted from page load. The boot splash in
 * index.html, the session check and the route loader hand off to each other without restarting
 * the glance, so you see the whole look-left, look-right, blink instead of the first second over
 * and over. Keyframes (.am-look / .am-lid*) live in index.html so they exist before any JS.
 */
export const ADMIN_MARK_PERIOD_MS = 3200;

export function AdminMark({
  className,
  label,
  animated = true,
}: {
  className?: string;
  label?: string;
  animated?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  // Negative delay = "already this far into the cycle", so remounts continue instead of restarting.
  const delay = useMemo(
    () => `-${Math.round((typeof performance !== "undefined" ? performance.now() : 0) % ADMIN_MARK_PERIOD_MS)}ms`,
    [],
  );
  const anim = animated ? "" : " am-still";
  const style = { ["--am-delay" as string]: delay } as React.CSSProperties;

  return (
    <svg
      viewBox="0 0 72 72"
      className={cn("select-none text-white" + anim, className)}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <mask id={`m${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72">
          <rect width="72" height="72" fill="#fff" />
          <circle cx="19" cy="44" r="10.3" />
          <circle cx="53" cy="44" r="10.3" />
        </mask>
        <clipPath id={`cl${uid}`}><circle cx="19" cy="44" r="10.7" /></clipPath>
        <clipPath id={`cr${uid}`}><circle cx="53" cy="44" r="10.7" /></clipPath>
        <mask id={`pm${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72">
          <rect width="72" height="72" fill="#fff" />
          <g className="am-lidL"><rect x="0" y="10" width="40" height="34.8" /></g>
          <g className="am-lidR"><rect x="32" y="10" width="40" height="34.8" /></g>
        </mask>
      </defs>
      <g mask={`url(#m${uid})`}>
        <path className="am-st" d="M9 37L13.5 21Q14 18 17 18H21Q24 18 24.5 21L29 37M43 37L47.5 21Q48 18 51 18H55Q58 18 58.5 21L63 37" />
        <path className="am-st" d="M25.5 27H46.5M30 42H42" />
      </g>
      <circle className="am-st" cx="19" cy="44" r="13" />
      <circle className="am-st" cx="53" cy="44" r="13" />
      <g mask={`url(#pm${uid})`}>
        <g className="am-look">
          <circle className="am-fl" cx="19" cy="44" r="4.8" />
          <circle className="am-fl" cx="53" cy="44" r="4.8" />
        </g>
      </g>
      <g clipPath={`url(#cl${uid})`}><g className="am-lidL"><rect className="am-fl" x="0" y="10" width="40" height="32" /></g></g>
      <g clipPath={`url(#cr${uid})`}><g className="am-lidR"><rect className="am-fl" x="32" y="10" width="40" height="32" /></g></g>
    </svg>
  );
}
