import { useId, useMemo, useRef } from "react";
import { STARE_RADIUS_PX, useStare } from "@/components/AdminMark";
import { cn } from "@/lib/utils";

/**
 * The partner mark: a little desk globe with the same eyes as the admin binoculars.
 * The binoculars spot things (Jared, Scout); the globe is where it all goes (Eli, the partner side).
 * (The earlier compass lives in components/archive/CompassMark.tsx.)
 *
 * Same stroke weight and round caps as AdminMark. Idle: glance left, glance right, blink, and the
 * globe wobbles on its axis. With watchCursor, when the pointer comes near, the eyes lock onto it,
 * the lids narrow, and the globe leans toward it.
 */
const PERIOD_MS = 3600;
const REACH = { x: 2.2, y: 1.8 };
const C = { x: 36, y: 32 };             // centre of the globe
const R = 21;
const EYE_L = { x: 26.5, y: 34 };
const EYE_R = { x: 45.5, y: 34 };
const TILT = -18;                        // axial tilt of the grid lines, degrees

const CSS = `
.gm-st{fill:none;stroke:currentColor;stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round}
.gm-grid{fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round}
.gm-ring{fill:none;stroke:currentColor;stroke-width:3.4;stroke-linecap:round}
.gm-eye{fill:none;stroke:currentColor;stroke-width:3.2}
.gm-fl{fill:currentColor}
.gm-blush{fill:currentColor;opacity:.22}
.gm-look,.gm-lid,.gm-tilt{transform-box:view-box;animation-duration:${PERIOD_MS}ms;animation-iteration-count:infinite;animation-delay:var(--gm-delay,0ms)}
.gm-look{animation-name:gm-look;animation-timing-function:cubic-bezier(.45,1.5,.5,1)}
.gm-lid{animation-name:gm-lid;animation-timing-function:cubic-bezier(.4,1.35,.5,1)}
.gm-tilt{transform-origin:${C.x}px ${C.y}px;transform:rotate(${TILT}deg);animation-name:gm-wobble;animation-timing-function:cubic-bezier(.45,1.4,.5,1)}
@keyframes gm-look{0%,10%{transform:translate(0,0)}20%,40%{transform:translate(-2.2px,.5px)}50%,70%{transform:translate(2.2px,.5px)}80%,100%{transform:translate(0,0)}}
@keyframes gm-lid{0%,84%{transform:translateY(-9px)}89%{transform:translateY(0)}94%,100%{transform:translateY(-9px)}}
@keyframes gm-wobble{0%,10%{transform:rotate(${TILT}deg)}25%,40%{transform:rotate(${TILT - 9}deg)}55%,70%{transform:rotate(${TILT + 8}deg)}85%,100%{transform:rotate(${TILT}deg)}}
.gm-still .gm-look,.gm-still .gm-lid,.gm-still .gm-tilt{animation:none}
.gm-still .gm-lid{transform:translateY(-9px)}
.gm-watching .gm-look,.gm-watching .gm-lid,.gm-watching .gm-tilt{animation:none;transition:transform .2s cubic-bezier(.2,.8,.2,1)}
.gm-body,.gm-mer,.gm-spark{transform-box:view-box}
.gm-body{transform-origin:36px 65px}
.gm-mer{transform-origin:${C.x}px ${C.y}px}
.gm-spark{opacity:0;transform:scale(0)}
.gm-excited .gm-body{animation:gm-shake .6s cubic-bezier(.36,.07,.19,.97) both}
.gm-excited .gm-mer{animation:gm-spin .95s cubic-bezier(.3,.6,.4,1) .08s both}
.gm-excited .gm-look{animation:gm-lookname .7s cubic-bezier(.3,1.6,.5,1) .38s both}
.gm-excited .gm-lid{animation:gm-blinkwide .6s ease .3s both}
.gm-excited .gm-tilt{animation:none}
.gm-excited .gm-spark{animation:gm-pop .5s cubic-bezier(.3,1.8,.5,1) both}
.gm-excited .gm-spark.s2{animation-delay:.12s}.gm-excited .gm-spark.s3{animation-delay:.22s}
@keyframes gm-shake{0%{transform:none}12%{transform:rotate(-14deg) translateY(-2px)}26%{transform:rotate(12deg) translateY(-3.5px)}40%{transform:rotate(-9deg) translateY(-1px)}54%{transform:rotate(6deg)}68%{transform:rotate(-3deg)}82%{transform:rotate(1.5deg)}100%{transform:none}}
@keyframes gm-spin{0%{transform:scaleX(1)}20%{transform:scaleX(.08)}40%{transform:scaleX(1.25)}60%{transform:scaleX(.08)}80%{transform:scaleX(1.1)}100%{transform:scaleX(1)}}
@keyframes gm-lookname{0%{transform:translate(0,0)}100%{transform:translate(2.5px,.3px)}}
@keyframes gm-blinkwide{0%{transform:translateY(-9px)}35%{transform:translateY(0)}55%,100%{transform:translateY(-10px)}}
@keyframes gm-pop{0%{opacity:0;transform:scale(0) rotate(-40deg)}60%{opacity:1;transform:scale(1.25) rotate(10deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
@media (prefers-reduced-motion:reduce){.gm-look,.gm-lid,.gm-tilt{animation:none}.gm-lid{transform:translateY(-9px)}.gm-watching .gm-look,.gm-watching .gm-lid,.gm-watching .gm-tilt{transition:none}
.gm-excited .gm-body,.gm-excited .gm-mer,.gm-excited .gm-lid{animation:none}.gm-excited .gm-look{animation:none;transform:translate(2.5px,.3px)}.gm-excited .gm-spark{animation:none;opacity:1;transform:none}}
`;

export function PartnerMark({
  className,
  label,
  animated = true,
  watchCursor = true,
  stareRadius = STARE_RADIUS_PX,
  excited = false,
}: {
  /** Hovering the greeting: shake, spin the globe, look over at the name, sparkle. */
  excited?: boolean;
  className?: string;
  label?: string;
  animated?: boolean;
  watchCursor?: boolean;
  /** How close, in CSS px, before it stares. ~96px per inch. */
  stareRadius?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const stare = useStare(ref, watchCursor, REACH, 34 / 72, stareRadius);
  const delay = useMemo(
    () => `-${Math.round((typeof performance !== "undefined" ? performance.now() : 0) % PERIOD_MS)}ms`,
    [],
  );
  const watching = stare && !excited;
  const mode = excited ? " gm-excited" : watching ? " gm-watching" : animated ? "" : " gm-still";
  const look = watching ? { transform: `translate(${stare.x}px, ${stare.y}px)` } : undefined;
  const lid = watching ? { transform: "translateY(-5.2px)" } : undefined;
  // Lean the axis toward the cursor: left of the globe tilts left, right tilts right.
  const tilt = watching ? { transform: `rotate(${(TILT + (stare.x / REACH.x) * 14).toFixed(1)}deg)` } : undefined;
  const half = Math.sqrt(R * R - 10.5 * 10.5); // latitude lines sit 10.5 above and below the equator

  return (
    <svg
      ref={ref}
      viewBox="0 0 72 72"
      className={cn("select-none text-white" + mode, className)}
      style={{ ["--gm-delay" as string]: delay } as React.CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <style>{CSS}</style>
      <defs>
        <clipPath id={`gl${uid}`}><circle cx={EYE_L.x} cy={EYE_L.y} r="4" /></clipPath>
        <clipPath id={`gr${uid}`}><circle cx={EYE_R.x} cy={EYE_R.y} r="4" /></clipPath>
        <clipPath id={`gb${uid}`}><circle cx={C.x} cy={C.y} r={R - 1} /></clipPath>
        {/* grid lines pass behind the eyes, never across them */}
        <mask id={`gm${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72">
          <rect width="72" height="72" fill="#fff" />
          <circle cx={EYE_L.x} cy={EYE_L.y} r="7.8" />
          <circle cx={EYE_R.x} cy={EYE_R.y} r="7.8" />
        </mask>
      </defs>

      <g className="gm-body">
      {/* stand: half meridian ring, stem, base */}
      <path className="gm-ring" d={`M${C.x} ${C.y + R + 5} A${R + 5} ${R + 5} 0 0 0 ${C.x} ${C.y - R - 5}`} />
      <path className="gm-st" d={`M${C.x} ${C.y + R + 6}V62M27 65H45`} />

      {/* the globe */}
      <circle className="gm-st" cx={C.x} cy={C.y} r={R} />
      <g mask={`url(#gm${uid})`}>
        <g clipPath={`url(#gb${uid})`}>
          <g className="gm-tilt" style={tilt}>
            <ellipse className="gm-grid gm-mer" cx={C.x} cy={C.y} rx="8.5" ry={R} />
            <path className="gm-grid" d={`M${C.x - half} ${C.y - 10.5}Q${C.x} ${C.y - 5.5} ${C.x + half} ${C.y - 10.5}`} />
            <path className="gm-grid" d={`M${C.x - half} ${C.y + 10.5}Q${C.x} ${C.y + 15.5} ${C.x + half} ${C.y + 10.5}`} />
          </g>
        </g>
      </g>

      {/* eyes, blush */}
      <circle className="gm-eye" cx={EYE_L.x} cy={EYE_L.y} r="5.6" />
      <circle className="gm-eye" cx={EYE_R.x} cy={EYE_R.y} r="5.6" />
      <g className="gm-look" style={look}>
        <circle className="gm-fl" cx={EYE_L.x} cy={EYE_L.y} r="2.6" />
        <circle className="gm-fl" cx={EYE_R.x} cy={EYE_R.y} r="2.6" />
      </g>
      <g clipPath={`url(#gl${uid})`}><g className="gm-lid" style={lid}><rect className="gm-fl" x={EYE_L.x - 6} y={EYE_L.y - 4.2} width="12" height="8.4" /></g></g>
      <g clipPath={`url(#gr${uid})`}><g className="gm-lid" style={lid}><rect className="gm-fl" x={EYE_R.x - 6} y={EYE_R.y - 4.2} width="12" height="8.4" /></g></g>
      <ellipse className="gm-blush" cx={EYE_L.x - 1.5} cy={EYE_L.y + 8.5} rx="3.2" ry="1.8" />
      <ellipse className="gm-blush" cx={EYE_R.x + 1.5} cy={EYE_R.y + 8.5} rx="3.2" ry="1.8" />
      </g>

      {/* sparkles, only while excited */}
      <path className="gm-spark gm-fl" style={{ transformOrigin: "63px 9px" }} d="M63 4l1.4 3.6L68 9l-3.6 1.4L63 14l-1.4-3.6L58 9l3.6-1.4z" />
      <path className="gm-spark gm-fl s2" style={{ transformOrigin: "68px 22px" }} d="M68 19.2l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" />
      <path className="gm-spark gm-fl s3" style={{ transformOrigin: "9px 12px" }} d="M9 9.2l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" />
    </svg>
  );
}
