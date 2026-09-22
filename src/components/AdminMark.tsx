import { useEffect, useId, useMemo, useRef, useState } from "react";
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

/** How close the cursor must be before the mark stops glancing and stares at it (~1.5 inches). */
const STARE_RADIUS_PX = 150;
/** How far the pupils can travel inside the lenses (SVG units, same as the glance keyframes). */
const PUPIL_REACH = { x: 5.4, y: 3.6 };

export type Stare = { x: number; y: number; a?: number } | null;

/**
 * Pupils follow the pointer while it is within STARE_RADIUS_PX of the mark. Outside that, the
 * normal glance animation runs. Mouse/pen only (touch has no hover), one rAF per frame.
 */
export function useStare(ref: React.RefObject<SVGSVGElement>, enabled: boolean, reach = PUPIL_REACH, eyeLine = 0.61): Stare {
  const [stare, setStare] = useState<Stare>(null);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el || !last) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height * eyeLine; // eye line (y=44 of 72 here)
      const dx = last.clientX - cx, dy = last.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > STARE_RADIUS_PX) { setStare((s) => (s ? null : s)); return; }
      // Full reach once the cursor is a few mark-widths away; gentler right on top of it.
      const k = Math.min(1, d / Math.max(24, r.width * 1.2));
      const nx = d ? dx / d : 0, ny = d ? dy / d : 0;
      setStare({ x: +(nx * reach.x * k).toFixed(2), y: +(ny * reach.y * k).toFixed(2), a: Math.round((Math.atan2(dy, dx) * 180) / Math.PI) });
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      last = e;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onLeave = () => setStare(null);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, ref, reach.x, reach.y, eyeLine]);
  return stare;
}

export function AdminMark({
  className,
  label,
  animated = true,
  watchCursor = false,
}: {
  className?: string;
  label?: string;
  animated?: boolean;
  /** Stare at the pointer when it comes within ~1.5 inches. */
  watchCursor?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const stare = useStare(svgRef, watchCursor);
  const uid = useId().replace(/:/g, "");
  // Negative delay = "already this far into the cycle", so remounts continue instead of restarting.
  const delay = useMemo(
    () => `-${Math.round((typeof performance !== "undefined" ? performance.now() : 0) % ADMIN_MARK_PERIOD_MS)}ms`,
    [],
  );
  const anim = stare ? " am-watching" : animated ? "" : " am-still";
  // Staring: pupils on the cursor, lids lowered and tilted in, a suspicious squint.
  const look = stare ? { transform: `translate(${stare.x}px, ${stare.y}px)` } : undefined;
  const lidL = stare ? { transform: "translateY(-3px) rotate(7deg)" } : undefined;
  const lidR = stare ? { transform: "translateY(-3px) rotate(-7deg)" } : undefined;
  const style = { ["--am-delay" as string]: delay } as React.CSSProperties;

  return (
    <svg
      ref={svgRef}
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
          <g className="am-lidL" style={lidL}><rect x="0" y="10" width="40" height="34.8" /></g>
          <g className="am-lidR" style={lidR}><rect x="32" y="10" width="40" height="34.8" /></g>
        </mask>
      </defs>
      <g mask={`url(#m${uid})`}>
        <path className="am-st" d="M9 37L13.5 21Q14 18 17 18H21Q24 18 24.5 21L29 37M43 37L47.5 21Q48 18 51 18H55Q58 18 58.5 21L63 37" />
        <path className="am-st" d="M25.5 27H46.5M30 42H42" />
      </g>
      <circle className="am-st" cx="19" cy="44" r="13" />
      <circle className="am-st" cx="53" cy="44" r="13" />
      <g mask={`url(#pm${uid})`}>
        <g className="am-look" style={look}>
          <circle className="am-fl" cx="19" cy="44" r="4.8" />
          <circle className="am-fl" cx="53" cy="44" r="4.8" />
        </g>
      </g>
      <g clipPath={`url(#cl${uid})`}><g className="am-lidL" style={lidL}><rect className="am-fl" x="0" y="10" width="40" height="32" /></g></g>
      <g clipPath={`url(#cr${uid})`}><g className="am-lidR" style={lidR}><rect className="am-fl" x="32" y="10" width="40" height="32" /></g></g>
    </svg>
  );
}
