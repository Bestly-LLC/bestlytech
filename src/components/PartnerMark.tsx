import { useId, useMemo, useRef } from "react";
import { useStare } from "@/components/AdminMark";
import { cn } from "@/lib/utils";

/**
 * The partner mark: a pocket compass with the same eyes as the admin binoculars.
 * The binoculars spot things (Jared, Scout); the compass steers (Eli, the partner side).
 *
 * Same stroke weight and round caps as AdminMark. Idle: glance left, glance right, blink,
 * and the needle sways. With watchCursor, when the pointer comes within ~1.5 inches the
 * eyes lock onto it, the lids narrow, and the needle swings to point straight at it.
 */
const PERIOD_MS = 3600;
const REACH = { x: 2.9, y: 2.4 };
const EYE_L = { x: 26.5, y: 38 };
const EYE_R = { x: 45.5, y: 38 };
const NEEDLE = { x: 36, y: 54 };

const CSS = `
.pm-st{fill:none;stroke:currentColor;stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round}
.pm-st-thin{fill:none;stroke:currentColor;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}
.pm-fl{fill:currentColor}
.pm-look,.pm-lid,.pm-needle{transform-box:view-box;animation-duration:${PERIOD_MS}ms;animation-iteration-count:infinite;animation-delay:var(--pm-delay,0ms)}
.pm-look{animation-name:pm-look;animation-timing-function:cubic-bezier(.45,1.5,.5,1)}
.pm-lid{animation-name:pm-lid;animation-timing-function:cubic-bezier(.4,1.35,.5,1)}
.pm-needle{transform-origin:${NEEDLE.x}px ${NEEDLE.y}px;animation-name:pm-sway;animation-timing-function:cubic-bezier(.45,1.4,.5,1)}
@keyframes pm-look{0%,10%{transform:translate(0,0)}20%,40%{transform:translate(-2.9px,.8px)}50%,70%{transform:translate(2.9px,.8px)}80%,100%{transform:translate(0,0)}}
@keyframes pm-lid{0%,84%{transform:translateY(-13px)}89%{transform:translateY(0)}94%,100%{transform:translateY(-13px)}}
@keyframes pm-sway{0%,10%{transform:rotate(12deg)}25%,40%{transform:rotate(-14deg)}55%,70%{transform:rotate(18deg)}85%,100%{transform:rotate(12deg)}}
.pm-still .pm-look,.pm-still .pm-lid,.pm-still .pm-needle{animation:none}
.pm-still .pm-lid{transform:translateY(-13px)}
.pm-still .pm-needle{transform:rotate(12deg)}
.pm-watching .pm-look,.pm-watching .pm-lid,.pm-watching .pm-needle{animation:none;transition:transform .2s cubic-bezier(.2,.8,.2,1)}
@media (prefers-reduced-motion:reduce){.pm-look,.pm-lid,.pm-needle{animation:none}.pm-lid{transform:translateY(-13px)}.pm-needle{transform:rotate(12deg)}.pm-watching .pm-look,.pm-watching .pm-lid,.pm-watching .pm-needle{transition:none}}
`;

export function PartnerMark({
  className,
  label,
  animated = true,
  watchCursor = false,
}: {
  className?: string;
  label?: string;
  animated?: boolean;
  watchCursor?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const stare = useStare(ref, watchCursor, REACH, 38 / 72);
  const delay = useMemo(
    () => `-${Math.round((typeof performance !== "undefined" ? performance.now() : 0) % PERIOD_MS)}ms`,
    [],
  );
  const mode = stare ? " pm-watching" : animated ? "" : " pm-still";
  const look = stare ? { transform: `translate(${stare.x}px, ${stare.y}px)` } : undefined;
  const lid = stare ? { transform: "translateY(-8px)" } : undefined;
  // The needle's tip points up at rest, so the screen angle + 90deg aims it at the cursor.
  const needle = stare && stare.a !== undefined ? { transform: `rotate(${stare.a + 90}deg)` } : undefined;

  return (
    <svg
      ref={ref}
      viewBox="0 0 72 72"
      className={cn("select-none text-white" + mode, className)}
      style={{ ["--pm-delay" as string]: delay } as React.CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <style>{CSS}</style>
      <defs>
        <clipPath id={`el${uid}`}><circle cx={EYE_L.x} cy={EYE_L.y} r="5.8" /></clipPath>
        <clipPath id={`er${uid}`}><circle cx={EYE_R.x} cy={EYE_R.y} r="5.8" /></clipPath>
      </defs>

      {/* bow ring and the case */}
      <circle className="pm-st" cx="36" cy="8.5" r="4.2" />
      <circle className="pm-st" cx="36" cy="41" r="27" />
      {/* N tick */}
      <path className="pm-st-thin" d="M36 18.5V21.5" />

      {/* eyes */}
      <circle className="pm-st-thin" cx={EYE_L.x} cy={EYE_L.y} r="8.2" />
      <circle className="pm-st-thin" cx={EYE_R.x} cy={EYE_R.y} r="8.2" />
      <g className="pm-look" style={look}>
        <circle className="pm-fl" cx={EYE_L.x} cy={EYE_L.y} r="3.3" />
        <circle className="pm-fl" cx={EYE_R.x} cy={EYE_R.y} r="3.3" />
      </g>
      <g clipPath={`url(#el${uid})`}><g className="pm-lid" style={lid}><rect className="pm-fl" x="18" y="31.8" width="17" height="12.6" /></g></g>
      <g clipPath={`url(#er${uid})`}><g className="pm-lid" style={lid}><rect className="pm-fl" x="37" y="31.8" width="17" height="12.6" /></g></g>

      {/* needle: filled north half, outlined south half */}
      <g className="pm-needle" style={needle}>
        <path className="pm-fl" d={`M${NEEDLE.x} ${NEEDLE.y - 8.5}L${NEEDLE.x + 3.4} ${NEEDLE.y}H${NEEDLE.x - 3.4}Z`} />
        <path className="pm-st-thin" style={{ strokeWidth: 2.2 }} d={`M${NEEDLE.x - 3.4} ${NEEDLE.y}L${NEEDLE.x} ${NEEDLE.y + 8.5}L${NEEDLE.x + 3.4} ${NEEDLE.y}`} />
        <circle className="pm-fl" cx={NEEDLE.x} cy={NEEDLE.y} r="1.6" />
      </g>
    </svg>
  );
}
