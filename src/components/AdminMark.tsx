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
export const STARE_RADIUS_PX = 150;
/** Sign-in screens: the mark is the only thing on the page, so it notices you from further off (~4 inches). */
export const SIGNIN_STARE_RADIUS_PX = 384;
/** How far the pupils can travel inside the lenses (SVG units, same as the glance keyframes). */
const PUPIL_REACH = { x: 5.4, y: 3.6 };

export type Stare = { x: number; y: number; a?: number } | null;

/**
 * "Couldn't check admin access": the binoculars get sad (droopy lids, eyes down, two tears, a little
 * quiver), squeeze shut, then get angry (lids slam inward, turn red, anger mark, shaking) and stay mad.
 * One 6s performance, then the anger keeps simmering. Reduced motion: just the final angry face.
 */
const MOOD_CSS = `
.am-mood{animation:am-sm-color 6s linear forwards}
.am-mood .am-lidL,.am-mood .am-lidR,.am-mood .am-look{transform-box:view-box;animation-duration:6s;animation-iteration-count:1;animation-fill-mode:forwards;animation-delay:0s;animation-timing-function:cubic-bezier(.4,1.2,.5,1)}
.am-mood .am-lidL{animation-name:am-sm-lidL}.am-mood .am-lidR{animation-name:am-sm-lidR}.am-mood .am-look{animation-name:am-sm-look}
@keyframes am-sm-color{0%,62%{color:#fff}76%,100%{color:#FF453A}}
@keyframes am-sm-lidL{0%{transform:translateY(-13px) rotate(0)}12%,54%{transform:translateY(-6px) rotate(-16deg)}58%{transform:translateY(-5px) rotate(-18deg)}62%,67%{transform:translateY(12px) rotate(0)}76%,100%{transform:translateY(-4px) rotate(20deg)}}
@keyframes am-sm-lidR{0%{transform:translateY(-13px) rotate(0)}12%,54%{transform:translateY(-6px) rotate(16deg)}58%{transform:translateY(-5px) rotate(18deg)}62%,67%{transform:translateY(12px) rotate(0)}76%,100%{transform:translateY(-4px) rotate(-20deg)}}
@keyframes am-sm-look{0%{transform:translate(0,0)}12%,30%{transform:translate(-1.5px,3.4px)}40%,58%{transform:translate(1.5px,3.4px)}76%,100%{transform:translate(0,.6px)}}
.am-mood .am-quiver{animation:am-sm-quiver .2s ease-in-out .9s 14 alternate}
@keyframes am-sm-quiver{from{transform:translateY(0)}to{transform:translateY(.7px)}}
.am-mood .am-rage{animation:am-sm-rage 1.8s linear 4.5s infinite}
@keyframes am-sm-rage{0%{transform:translateX(0)}4%{transform:translateX(-1.8px)}8%{transform:translateX(1.8px)}12%{transform:translateX(-1.4px)}16%{transform:translateX(1.4px)}20%{transform:translateX(-.7px)}24%,100%{transform:translateX(0)}}
.am-mood .am-tear{opacity:0;animation:am-sm-tear 6s cubic-bezier(.5,0,.8,.6) forwards}
.am-mood .am-tear2{animation-delay:.9s}
@keyframes am-sm-tear{0%,18%{opacity:0;transform:translateY(0) scale(.4)}24%{opacity:1;transform:translateY(0) scale(1)}46%{opacity:1;transform:translateY(15px) scale(1)}52%,100%{opacity:0;transform:translateY(19px) scale(.8)}}
.am-mood .am-vein{transform-box:fill-box;transform-origin:center;opacity:0;animation:am-sm-vein 6s ease-out forwards,am-sm-throb 1.8s ease-in-out 6s infinite}
@keyframes am-sm-vein{0%,72%{opacity:0;transform:scale(.2)}80%{opacity:1;transform:scale(1.35)}86%,100%{opacity:1;transform:scale(1)}}
@keyframes am-sm-throb{0%,100%{opacity:1;transform:scale(1)}50%{opacity:1;transform:scale(1.25)}}
@media (prefers-reduced-motion:reduce){
  .am-mood,.am-mood *{animation:none!important}
  .am-mood{color:#FF453A}
  .am-mood .am-lidL{transform:translateY(-4px) rotate(20deg)}.am-mood .am-lidR{transform:translateY(-4px) rotate(-20deg)}
  .am-mood .am-look{transform:translate(0,.6px)}.am-mood .am-tear{opacity:0}.am-mood .am-vein{opacity:1}
}`;

/**
 * Pupils follow the pointer while it is within STARE_RADIUS_PX of the mark. Outside that, the
 * normal glance animation runs. Mouse/pen only (touch has no hover), one rAF per frame.
 */
export function useStare(ref: React.RefObject<SVGSVGElement>, enabled: boolean, reach = PUPIL_REACH, eyeLine = 0.61, radius = STARE_RADIUS_PX): Stare {
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
      if (d > radius) { setStare((s) => (s ? null : s)); return; }
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
  }, [enabled, ref, reach.x, reach.y, eyeLine, radius]);
  return stare;
}

export function AdminMark({
  className,
  label,
  animated = true,
  watchCursor = true,
  stareRadius = STARE_RADIUS_PX,
  mood,
}: {
  className?: string;
  label?: string;
  animated?: boolean;
  /** Stare at the pointer when it comes near (on by default, everywhere). */
  watchCursor?: boolean;
  /** How close, in CSS px, before it stares. ~96px per inch. */
  stareRadius?: number;
  /** A one-off emotional performance instead of the glance (see MOOD_CSS). */
  mood?: "sad-angry";
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const stare = useStare(svgRef, watchCursor && !mood, PUPIL_REACH, 0.61, stareRadius);
  const uid = useId().replace(/:/g, "");
  // Negative delay = "already this far into the cycle", so remounts continue instead of restarting.
  const delay = useMemo(
    () => `-${Math.round((typeof performance !== "undefined" ? performance.now() : 0) % ADMIN_MARK_PERIOD_MS)}ms`,
    [],
  );
  const anim = mood ? " am-mood" : stare ? " am-watching" : animated ? "" : " am-still";
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
      {mood && <style>{MOOD_CSS}</style>}
      <g className="am-rage"><g className="am-quiver">
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
      {mood && (
        <>
          <g transform="translate(13 51)"><path className="am-tear" fill="#64D2FF" d="M0-3.4C1.7-.9 2.5.6 2.5 1.6a2.5 2.5 0 0 1-5 0C-2.5.6-1.7-.9 0-3.4Z" /></g>
          <g transform="translate(59 51)"><path className="am-tear am-tear2" fill="#64D2FF" d="M0-3.4C1.7-.9 2.5.6 2.5 1.6a2.5 2.5 0 0 1-5 0C-2.5.6-1.7-.9 0-3.4Z" /></g>
          <g transform="translate(64 8)"><path className="am-vein" fill="none" stroke="#FF453A" strokeWidth="2.2" strokeLinecap="round"
            d="M-5-1.6Q-1.6-1.6-1.6-5M1.6-5Q1.6-1.6 5-1.6M5 1.6Q1.6 1.6 1.6 5M-1.6 5Q-1.6 1.6-5 1.6" /></g>
        </>
      )}
      </g></g>
    </svg>
  );
}
