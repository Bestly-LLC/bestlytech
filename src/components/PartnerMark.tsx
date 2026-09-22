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
const REACH = { x: 2.3, y: 1.9 };
const C = { x: 36, y: 40 };            // centre of the face and the needle pivot
const EYE_L = { x: 24, y: 40 };
const EYE_R = { x: 48, y: 40 };

const CSS = `
.pm-st{fill:none;stroke:currentColor;stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round}
.pm-eye{fill:none;stroke:currentColor;stroke-width:3.4}
.pm-tick{fill:none;stroke:currentColor;stroke-width:3.2;stroke-linecap:round}
.pm-fl{fill:currentColor}
.pm-blush{fill:currentColor;opacity:.22}
.pm-look,.pm-lid,.pm-needle{transform-box:view-box;animation-duration:${PERIOD_MS}ms;animation-iteration-count:infinite;animation-delay:var(--pm-delay,0ms)}
.pm-look{animation-name:pm-look;animation-timing-function:cubic-bezier(.45,1.5,.5,1)}
.pm-lid{animation-name:pm-lid;animation-timing-function:cubic-bezier(.4,1.35,.5,1)}
.pm-needle{transform-origin:${C.x}px ${C.y}px;animation-name:pm-sway;animation-timing-function:cubic-bezier(.45,1.4,.5,1)}
@keyframes pm-look{0%,10%{transform:translate(0,0)}20%,40%{transform:translate(-2.3px,.6px)}50%,70%{transform:translate(2.3px,.6px)}80%,100%{transform:translate(0,0)}}
@keyframes pm-lid{0%,84%{transform:translateY(-9.5px)}89%{transform:translateY(0)}94%,100%{transform:translateY(-9.5px)}}
@keyframes pm-sway{0%,10%{transform:rotate(0)}25%,40%{transform:rotate(-18deg)}55%,70%{transform:rotate(16deg)}85%,100%{transform:rotate(0)}}
.pm-still .pm-look,.pm-still .pm-lid,.pm-still .pm-needle{animation:none}
.pm-still .pm-lid{transform:translateY(-9.5px)}
.pm-watching .pm-look,.pm-watching .pm-lid,.pm-watching .pm-needle{animation:none;transition:transform .2s cubic-bezier(.2,.8,.2,1)}
@media (prefers-reduced-motion:reduce){.pm-look,.pm-lid,.pm-needle{animation:none}.pm-lid{transform:translateY(-9.5px)}.pm-watching .pm-look,.pm-watching .pm-lid,.pm-watching .pm-needle{transition:none}}
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
  const stare = useStare(ref, watchCursor, REACH, 40 / 72);
  const delay = useMemo(
    () => `-${Math.round((typeof performance !== "undefined" ? performance.now() : 0) % PERIOD_MS)}ms`,
    [],
  );
  const mode = stare ? " pm-watching" : animated ? "" : " pm-still";
  const look = stare ? { transform: `translate(${stare.x}px, ${stare.y}px)` } : undefined;
  const lid = stare ? { transform: "translateY(-5.6px)" } : undefined;
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
        <clipPath id={`el${uid}`}><circle cx={EYE_L.x} cy={EYE_L.y} r="4.2" /></clipPath>
        <clipPath id={`er${uid}`}><circle cx={EYE_R.x} cy={EYE_R.y} r="4.2" /></clipPath>
        {/* the needle passes behind the eyes, never across them */}
        <mask id={`nm${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72">
          <rect width="72" height="72" fill="#fff" />
          <circle cx={EYE_L.x} cy={EYE_L.y} r="8.4" />
          <circle cx={EYE_R.x} cy={EYE_R.y} r="8.4" />
        </mask>
      </defs>

      {/* bow and case */}
      <circle className="pm-st" cx="36" cy="8.6" r="4.2" />
      <circle className="pm-st" cx={C.x} cy={C.y} r="27" />

      {/* N and the other three cardinal ticks: this is what makes it a compass, not a clock */}
      <text x={C.x} y="23.4" textAnchor="middle" className="pm-fl" style={{ fontSize: 8.6, fontWeight: 800, fontFamily: "system-ui, -apple-system, sans-serif" }}>N</text>
      <path className="pm-tick" d={`M${C.x} 60.5V63.5M12.5 ${C.y}H15.5M56.5 ${C.y}H59.5`} />

      {/* needle: filled north, outlined south, pivot dot */}
      <g mask={`url(#nm${uid})`}>
        <g className="pm-needle" style={needle}>
          <path className="pm-fl" d={`M${C.x} ${C.y - 15}L${C.x + 3.6} ${C.y}H${C.x - 3.6}Z`} />
          <path className="pm-tick" style={{ strokeWidth: 2.2, strokeLinejoin: "round" }} d={`M${C.x - 3.6} ${C.y}L${C.x} ${C.y + 15}L${C.x + 3.6} ${C.y}`} />
        </g>
      </g>
      <circle className="pm-fl" cx={C.x} cy={C.y} r="2" />

      {/* eyes, blush */}
      <circle className="pm-eye" cx={EYE_L.x} cy={EYE_L.y} r="6" />
      <circle className="pm-eye" cx={EYE_R.x} cy={EYE_R.y} r="6" />
      <g className="pm-look" style={look}>
        <circle className="pm-fl" cx={EYE_L.x} cy={EYE_L.y} r="2.8" />
        <circle className="pm-fl" cx={EYE_R.x} cy={EYE_R.y} r="2.8" />
      </g>
      <g clipPath={`url(#el${uid})`}><g className="pm-lid" style={lid}><rect className="pm-fl" x="18" y="35.8" width="12" height="8.6" /></g></g>
      <g clipPath={`url(#er${uid})`}><g className="pm-lid" style={lid}><rect className="pm-fl" x="42" y="35.8" width="12" height="8.6" /></g></g>
      <ellipse className="pm-blush" cx={EYE_L.x - 1} cy={EYE_L.y + 10} rx="3.6" ry="2" />
      <ellipse className="pm-blush" cx={EYE_R.x + 1} cy={EYE_R.y + 10} rx="3.6" ry="2" />
    </svg>
  );
}
