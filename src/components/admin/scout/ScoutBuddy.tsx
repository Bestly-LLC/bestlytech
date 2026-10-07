import { Component, useId, useMemo, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AdminMark, ADMIN_MARK_PERIOD_MS, STARE_RADIUS_PX, useStare } from "@/components/AdminMark";

/**
 * ScoutBuddy: the real Scout, the binoculars from the top-left logo, extended into a character.
 *
 * The body is AdminMark's drawing verbatim (same 72-unit grid, same 5.5 strokes, same masks), so at rest
 * he is indistinguishable from the logo and glances in unison with it (same global am-look / am-lid
 * keyframes from index.html, same --am-delay phase lock). Personality comes from parts he already has
 * (lids are eyebrows, pupils are gaze, the whole body is posture) plus a few extras that only show in the
 * moods that need them: the focus wheel on the bridge (it turns while he works), an eye shine, a "?",
 * a sweat drop, "z" and two sparkles. Everything is currentColor, transform and opacity only.
 *
 * AdminMark.tsx is not modified. If anything in here ever throws, the boundary below falls back to the
 * plain AdminMark so a mascot bug can never blank the Scout window.
 */

export type ScoutMood =
  | "idle" | "listening" | "thinking" | "working" | "searching" | "surprised"
  | "happy" | "proud" | "confused" | "needs" | "waiting" | "sad" | "sleepy";

export type ScoutBuddySize = "sm" | "md" | "lg";

/** For the Scout Lab: every mood, what it looks like and what triggers it. */
export const SCOUT_MOOD_INFO: { mood: ScoutMood; looks: string; trigger: string; oneShot: boolean }[] = [
  { mood: "idle", looks: "The logo: glance left, right, blink. Stares at a nearby cursor.", trigger: "Nothing going on.", oneShot: false },
  { mood: "listening", looks: "Eyes wide and a little up, leans in.", trigger: "You are typing to him.", oneShot: false },
  { mood: "thinking", looks: "Focus wheel turns, eyes drift up-left, lids half.", trigger: "A request is in flight (first 6 seconds).", oneShot: false },
  { mood: "working", looks: "Wheel turns, eyes scan the lenses, lids low, refocuses every 5 seconds.", trigger: "A run past 6 seconds, or a chain still going.", oneShot: false },
  { mood: "searching", looks: "Pupils zoom in and sweep slowly, head tilts.", trigger: "A read tool just ran (database, code, today, incidents, call notes).", oneShot: false },
  { mood: "surprised", looks: "Lids snap up, pupils pinpoint, little hop.", trigger: "A reply lands while the panel is closed (0.7 s).", oneShot: true },
  { mood: "happy", looks: "Eyes squeeze shut into smiling arcs, small hop.", trigger: "A normal reply arrives while you are looking (1.2 s).", oneShot: true },
  { mood: "proud", looks: "Starry eyes: bigger pupils with a shine, two sparkles, a hop.", trigger: "A reply after tool steps that says it is done (1.6 s).", oneShot: true },
  { mood: "confused", looks: "One lid up, one down, head tilt, a question mark draws in.", trigger: "His last reply asks you something, or the free AI is stuck.", oneShot: false },
  { mood: "needs", looks: "Wide eyes looking down-right at the chat, a small bob every 12 seconds.", trigger: "Orange state: something needs you.", oneShot: false },
  { mood: "waiting", looks: "The logo glance, but he blinks twice as often.", trigger: "Purple state: unread replies, nothing urgent.", oneShot: false },
  { mood: "sad", looks: "Lids droop outward, eyes down, one sweat drop.", trigger: "An error, Stop, or a failed tool the reply admits to (6 s).", oneShot: true },
  { mood: "sleepy", looks: "Lids half closed, slow breathing, a z drifts up.", trigger: "Panel closed, nothing waiting, 15 minutes idle.", oneShot: false },
];

const SIZE_CLASS: Record<ScoutBuddySize, string> = { sm: "h-6 w-6", md: "h-10 w-10", lg: "h-20 w-20" };
const STARE_RADIUS: Record<ScoutBuddySize, number> = { sm: 120, md: STARE_RADIUS_PX, lg: 260 };
/** Same pupil travel as AdminMark (SVG units). */
const REACH = { x: 5.4, y: 3.6 };
/** Moods that keep the logo's own glance; every other mood is a posed face. */
const GLANCE = new Set<ScoutMood>(["idle", "waiting"]);

/* ------------------------------------------------------------------------------------------------
 * CSS. Prefix sb-. Reuses the global .am-st / .am-fl / .am-look / .am-lidL / .am-lidR from index.html.
 *
 * Posed moods set variables on the svg (--lyL lid height, --lrL lid angle, --px/--py gaze, --ps pupil
 * scale, --tilt, --by) and the lids and gaze follow them with a spring transition. Loops and one-shot
 * reactions are keyframes on top, wrapped in prefers-reduced-motion: no-preference, so reduced motion
 * (or data-calm, which the Scout Lab uses to preview it) shows each mood's key pose, still.
 * Lid numbers: translateY(-13px) is fully open, -2.5px is the logo's half lid, +14px is a blink.
 * ---------------------------------------------------------------------------------------------- */
const STATIC_RULES = (root: string) => `
${root}[data-mood="proud"] .sb-sparkle{opacity:1}
${root}[data-mood="sad"] .sb-drop{opacity:1}
${root}[data-mood="sleepy"] .sb-z{opacity:.8}
${root}[data-wheel] .sb-wheel-spin{transform:rotate(30deg)}
${root}[data-mood="idle"] .am-lidL,${root}[data-mood="idle"] .am-lidR,${root}[data-mood="waiting"] .am-lidL,${root}[data-mood="waiting"] .am-lidR{transform:translateY(-.8px) rotate(-9deg)}
${root}[data-mood="idle"] .am-look,${root}[data-mood="waiting"] .am-look{transform:translate(-5.4px,3px)}
${root} *{animation:none!important;transition:none!important}
`;

export const SCOUT_BUDDY_CSS = `
.sb{overflow:visible;--sb-spring:cubic-bezier(.34,1.56,.64,1)}
.sb-line{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.sb-tilt,.sb-body{transform-box:view-box}
.sb-tilt{transform-origin:36px 44px}
.sb-body{transform-origin:36px 60px}
.sb-lens,.sb-pupil,.sb-shine,.sb-sparkle,.sb-drop,.sb-z{transform-box:fill-box;transform-origin:center}
.sb-pupil{transform:scale(var(--ps,1))}
.sb-shine{transform:scale(0)}
.sb-smile{fill:none;stroke:#000;stroke-width:3.2;stroke-linecap:round;opacity:0;stroke-dasharray:1;stroke-dashoffset:1}
.sb-sparkle,.sb-drop,.sb-z,.sb-q{opacity:0}
.sb-q-path{stroke-width:2.4;stroke-dasharray:1;stroke-dashoffset:1}
.sb[data-size="sm"] .sb-q-path{stroke-width:3.6}
.sb[data-size="sm"] .sb-xtra,.sb[data-size="sm"] .sb-md{display:none}
.sb[data-size="md"] .sb-sm,.sb[data-size="lg"] .sb-sm{display:none}
.sb-wheel{opacity:0;transform:scale(.4);transform-box:view-box;transform-origin:36px 17px;transition:opacity .2s ease,transform .35s var(--sb-spring)}
.sb-wheel-spin{transform-box:view-box;transform-origin:36px 17px}
.sb[data-wheel] .sb-wheel{opacity:1;transform:none}

/* Posed moods: lids, gaze, pupils, posture. */
.sb[data-pose] .am-lidL{animation:none;transform:translateY(var(--lyL,-13px)) rotate(var(--lrL,0deg));transition:transform .5s var(--sb-spring)}
.sb[data-pose] .am-lidR{animation:none;transform:translateY(var(--lyR,-13px)) rotate(var(--lrR,0deg));transition:transform .5s var(--sb-spring)}
.sb[data-pose] .am-look{animation:none;transform:translate(var(--px,0px),var(--py,0px));transition:transform .5s var(--sb-spring)}
.sb[data-pose] .sb-pupil{transition:transform .4s var(--sb-spring)}
.sb[data-pose] .sb-tilt{transform:rotate(var(--tilt,0deg));transition:transform .5s var(--sb-spring)}
.sb[data-pose] .sb-body{transform:translateY(var(--by,0px));transition:transform .4s var(--sb-spring)}
.sb[data-mood="listening"]{--lyL:-13px;--lyR:-13px;--py:-1.4px;--by:-1.5px}
.sb[data-mood="thinking"]{--lyL:-4.5px;--lyR:-7px;--px:-3px;--py:-2.6px}
.sb[data-mood="working"]{--lyL:-3px;--lyR:-3px;--lrL:6deg;--lrR:-6deg;--py:1px}
.sb[data-mood="searching"]{--lyL:-4px;--lyR:-4px;--py:.5px;--ps:.7;--tilt:-4deg}
.sb[data-mood="surprised"]{--lyL:-13px;--lyR:-13px;--ps:.62}
.sb[data-mood="happy"]{--lyL:14px;--lyR:14px}
.sb[data-mood="proud"]{--lyL:-6px;--lyR:-6px;--py:-1.5px;--ps:1.12}
.sb[data-mood="confused"]{--lyL:-13px;--lyR:-1px;--lrR:-6deg;--px:2.4px;--py:-2px;--tilt:-8deg}
.sb[data-mood="needs"]{--lyL:-13px;--lyR:-13px;--px:3px;--py:3.4px}
.sb[data-mood="sad"]{--lyL:-7px;--lyR:-7px;--lrL:-10deg;--lrR:10deg;--py:3.4px}
.sb[data-mood="sleepy"]{--lyL:2px;--lyR:2px;--py:3px}
.sb[data-mood="happy"] .sb-smile{opacity:1;stroke-dashoffset:0;transition:opacity .1s ease .15s,stroke-dashoffset .35s ease-out .15s}
.sb[data-mood="proud"] .sb-shine{transform:scale(1);transition:transform .3s var(--sb-spring)}
.sb[data-mood="confused"] .sb-q{opacity:1;transition:opacity .15s ease}
.sb[data-mood="confused"] .sb-q-path{stroke-dashoffset:0;transition:stroke-dashoffset .6s ease-out}

@media (prefers-reduced-motion:no-preference){
.sb[data-mood="waiting"] .am-lidL,.sb[data-mood="waiting"] .am-lidR{animation-name:sb-wait-lid}
@keyframes sb-wait-lid{0%,6%{transform:translateY(-13px) rotate(0)}14%,18%{transform:translateY(-2.5px) rotate(0)}24%,42%{transform:translateY(-.8px) rotate(-9deg)}46%{transform:translateY(14px) rotate(0)}51%,52%{transform:translateY(-2.5px) rotate(0)}58%,72%{transform:translateY(-.8px) rotate(9deg)}82%{transform:translateY(-15px) rotate(0)}87%{transform:translateY(-13px) rotate(0)}91%{transform:translateY(14px) rotate(0)}95%,100%{transform:translateY(-13px) rotate(0)}}

/* thinking and working: the focus wheel turns (loading motion only) */
.sb[data-wheel] .sb-wheel-spin{animation:sb-spin 1.4s linear infinite}
@keyframes sb-spin{to{transform:rotate(360deg)}}
.sb[data-mood="thinking"] .am-look{animation:sb-think-look 2.6s ease-in-out infinite alternate}
@keyframes sb-think-look{from{transform:translate(-3.4px,-2.2px)}to{transform:translate(-1.6px,-3.4px)}}
.sb[data-mood="working"] .am-look{animation:sb-scan 2.4s ease-in-out infinite alternate}
@keyframes sb-scan{from{transform:translate(-4.6px,1.2px)}to{transform:translate(4.6px,1.2px)}}
.sb[data-mood="working"] .sb-lens{animation:sb-refocus 5s ease-in-out infinite}
@keyframes sb-refocus{0%,88%,100%{transform:scale(1)}93%{transform:scale(.94)}}
.sb[data-mood="searching"] .am-look{animation:sb-search-look 3.6s ease-in-out infinite alternate}
@keyframes sb-search-look{from{transform:translate(-4px,.6px)}to{transform:translate(4px,-.4px)}}

/* surprised: lids snap up, pupils pinpoint, a hop (700 ms) */
.sb[data-mood="surprised"] .am-lidL,.sb[data-mood="surprised"] .am-lidR{animation:sb-sur-lid .7s var(--sb-spring)}
@keyframes sb-sur-lid{0%{transform:translateY(-2.5px) rotate(0)}18%{transform:translateY(-15px) rotate(0)}100%{transform:translateY(-13px) rotate(0)}}
.sb[data-mood="surprised"] .sb-pupil{animation:sb-sur-pupil .7s var(--sb-spring)}
@keyframes sb-sur-pupil{0%{transform:scale(1)}20%{transform:scale(.5)}100%{transform:scale(.62)}}
.sb[data-mood="surprised"] .sb-body{animation:sb-hop .7s var(--sb-spring)}
@keyframes sb-hop{0%{transform:translateY(0)}30%{transform:translateY(-4px)}60%{transform:translateY(.8px)}100%{transform:translateY(0)}}

/* happy and proud: a hop, an eye shine and sparkles (1.2 s and 1.6 s) */
.sb[data-mood="happy"] .sb-body,.sb[data-mood="proud"] .sb-body{animation:sb-hop-s 1.2s var(--sb-spring)}
@keyframes sb-hop-s{0%{transform:translateY(0)}25%{transform:translateY(-3px)}50%{transform:translateY(.5px)}100%{transform:translateY(0)}}
.sb[data-mood="proud"] .sb-shine{animation:sb-shine 1.6s var(--sb-spring)}
@keyframes sb-shine{0%,25%{transform:scale(0)}45%{transform:scale(1.5)}65%,100%{transform:scale(1)}}
.sb[data-mood="proud"] .sb-sparkle{animation:sb-spark 1.6s ease-out}
.sb[data-mood="proud"] .sb-spark2{animation-delay:.18s}
@keyframes sb-spark{0%{opacity:0;transform:scale(.2) rotate(0)}30%{opacity:1;transform:scale(1.15) rotate(45deg)}60%{opacity:1;transform:scale(.9) rotate(45deg)}100%{opacity:0;transform:scale(.4) rotate(90deg)}}

/* needs: a small bob every 12 s */
.sb[data-mood="needs"] .sb-body{animation:sb-bob 12s ease-in-out infinite}
@keyframes sb-bob{0%,90%,100%{transform:translateY(0)}93%{transform:translateY(-3.5px)}96.5%{transform:translateY(.8px)}}

/* sad: lids droop, one drop falls, then a softer droop holds (1.6 s) */
.sb[data-mood="sad"] .am-lidL{animation:sb-sad-lidL 1.6s var(--sb-spring)}
.sb[data-mood="sad"] .am-lidR{animation:sb-sad-lidR 1.6s var(--sb-spring)}
@keyframes sb-sad-lidL{0%{transform:translateY(-13px) rotate(0)}35%{transform:translateY(-5px) rotate(-18deg)}100%{transform:translateY(-7px) rotate(-10deg)}}
@keyframes sb-sad-lidR{0%{transform:translateY(-13px) rotate(0)}35%{transform:translateY(-5px) rotate(18deg)}100%{transform:translateY(-7px) rotate(10deg)}}
.sb[data-mood="sad"] .sb-drop{animation:sb-drop 1.6s ease-in}
@keyframes sb-drop{0%{opacity:0;transform:translateY(0) scale(.5)}25%{opacity:1;transform:translateY(0) scale(1)}85%{opacity:1;transform:translateY(7px) scale(1)}100%{opacity:0;transform:translateY(8px) scale(.9)}}

/* sleepy: slow breathing, a z drifts up every 8 s */
.sb[data-mood="sleepy"] .sb-body{animation:sb-breath 4s ease-in-out infinite}
@keyframes sb-breath{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.975)}}
.sb[data-mood="sleepy"] .sb-z{animation:sb-zz 8s ease-out infinite}
.sb[data-mood="sleepy"] .sb-z2{animation-delay:.6s}
@keyframes sb-zz{0%{opacity:0;transform:translate(0,0)}6%{opacity:.9}30%{opacity:0;transform:translate(3px,-6px)}100%{opacity:0;transform:translate(3px,-6px)}}
}

/* Reduced motion (and the Lab's calm preview): every mood shows its key pose, still. The words keep the news. */
@media (prefers-reduced-motion:reduce){${STATIC_RULES(".sb")}}
${STATIC_RULES(".sb[data-calm]")}
`;

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById("sb-css")) return;
  const s = document.createElement("style");
  s.id = "sb-css";
  s.textContent = SCOUT_BUDDY_CSS;
  document.head.appendChild(s);
}
ensureStyles();

interface BuddyProps {
  mood?: ScoutMood;
  size?: ScoutBuddySize;
  className?: string;
  /** Accessible name. Leave out when the surrounding control already says it (the SVG is then aria-hidden). */
  label?: string;
  /** Stare at the pointer when it comes near (idle and waiting only). */
  watchCursor?: boolean;
  /** Bump to replay a mood from its first frame (remounts, which restarts any loop or one-shot). */
  replay?: number;
  /** Show every mood's still key pose, as reduced motion does. Used by the Scout Lab preview. */
  calm?: boolean;
}

function BuddyInner({ mood = "idle", size = "sm", className, label, watchCursor = true, calm }: BuddyProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const glance = GLANCE.has(mood);
  const stare = useStare(svgRef, watchCursor && glance && !calm, REACH, 0.61, STARE_RADIUS[size]);
  const uid = useId().replace(/:/g, "");
  // Negative delay = "already this far into the cycle": the same phase lock as the logo, so he glances in unison with it.
  const delay = useMemo(
    () => `-${Math.round((typeof performance !== "undefined" ? performance.now() : 0) % ADMIN_MARK_PERIOD_MS)}ms`,
    [],
  );
  const wheel = mood === "thinking" || mood === "working";
  const look = stare ? { transform: `translate(${stare.x}px, ${stare.y}px)` } : undefined;
  const lidL = stare ? { transform: "translateY(-3px) rotate(7deg)" } : undefined;
  const lidR = stare ? { transform: "translateY(-3px) rotate(-7deg)" } : undefined;
  const style = { ["--am-delay" as string]: delay } as React.CSSProperties;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 72 72"
      className={cn("sb select-none text-current", SIZE_CLASS[size], stare && "am-watching", className)}
      style={style}
      data-mood={mood}
      data-size={size}
      data-pose={glance ? undefined : mood}
      data-wheel={wheel ? "1" : undefined}
      data-calm={calm ? "1" : undefined}
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
        <mask id={`sl${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72">
          <rect width="72" height="72" fill="#fff" />
          <path className="sb-smile" pathLength={1} d="M10.8 48Q19 36.5 27.2 48" />
        </mask>
        <mask id={`sr${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72">
          <rect width="72" height="72" fill="#fff" />
          <path className="sb-smile" pathLength={1} d="M44.8 48Q53 36.5 61.2 48" />
        </mask>
        {/* The eye shine: a small hole punched in the pupil, upper left. Scale 0 (nothing) until proud. */}
        <mask id={`hl${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72">
          <rect width="72" height="72" fill="#fff" />
          <circle className="sb-shine" cx="17.1" cy="42.1" r="1.3" fill="#000" />
        </mask>
        <mask id={`hr${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72">
          <rect width="72" height="72" fill="#fff" />
          <circle className="sb-shine" cx="51.1" cy="42.1" r="1.3" fill="#000" />
        </mask>
      </defs>
      <g className="sb-tilt"><g className="sb-body">
        <g mask={`url(#m${uid})`}>
          <path className="am-st" d="M9 37L13.5 21Q14 18 17 18H21Q24 18 24.5 21L29 37M43 37L47.5 21Q48 18 51 18H55Q58 18 58.5 21L63 37" />
          <path className="am-st" d="M25.5 27H46.5M30 42H42" />
        </g>
        {/* The focus wheel, on the bridge: ring centre (36,17); the bridge's top edge is y 24.25 and the barrels' inner edges are x 27 and 45. */}
        <g className="sb-wheel">
          <path className="sb-line" d="M36 21V25.4" style={{ strokeWidth: 2.4 }} />
          <g className="sb-wheel-spin">
            <circle className="sb-line sb-md" cx="36" cy="17" r="3.4" style={{ strokeWidth: 2 }} />
            <circle className="sb-line sb-sm" cx="36" cy="17" r="3.6" style={{ strokeWidth: 2.6 }} />
            <path className="sb-line sb-md" d="M32.9 17H39.1" style={{ strokeWidth: 1.2 }} />
            <path className="sb-line sb-md" d="M32.9 17H39.1" style={{ strokeWidth: 1.2 }} transform="rotate(60 36 17)" />
            <path className="sb-line sb-md" d="M32.9 17H39.1" style={{ strokeWidth: 1.2 }} transform="rotate(120 36 17)" />
            <path className="sb-line sb-sm" d="M32.4 17H39.6" style={{ strokeWidth: 2.2 }} />
          </g>
        </g>
        <circle className="am-st sb-lens" cx="19" cy="44" r="13" />
        <circle className="am-st sb-lens" cx="53" cy="44" r="13" />
        <g mask={`url(#pm${uid})`}>
          <g className="am-look" style={look}>
            <g mask={`url(#hl${uid})`}><circle className="am-fl sb-pupil" cx="19" cy="44" r="4.8" /></g>
            <g mask={`url(#hr${uid})`}><circle className="am-fl sb-pupil" cx="53" cy="44" r="4.8" /></g>
          </g>
        </g>
        {/* Happy: the lids squeeze shut and a "^" is cut out of each (the masks above), so he smiles with his eyes. */}
        <g clipPath={`url(#cl${uid})`} mask={`url(#sl${uid})`}>
          <g className="am-lidL" style={lidL}><rect className="am-fl" x="0" y="10" width="40" height="32" /></g>
        </g>
        <g clipPath={`url(#cr${uid})`} mask={`url(#sr${uid})`}>
          <g className="am-lidR" style={lidR}><rect className="am-fl" x="32" y="10" width="40" height="32" /></g>
        </g>
      </g></g>

      {/* Extras live outside the tilt so they stay put when his head tilts. All on the 72 grid, clear of the 5.5 strokes. */}
      <g className="sb-q">
        <path className="sb-line sb-q-path" pathLength={1} d="M62.8 8.4Q62.8 3.6 66.6 3.6Q70.4 3.6 70.4 7.4Q70.4 10 66.6 11.2V13" />
        <circle cx="66.6" cy="17" r="1.5" fill="currentColor" />
      </g>
      <g className="sb-xtra">
        <g transform="translate(4 22)"><path className="sb-drop" fill="currentColor" d="M0-3.4C1.7-.9 2.5.6 2.5 1.6a2.5 2.5 0 0 1-5 0Z" /></g>
        <g transform="translate(64 9)"><path className="sb-line sb-z sb-z1" style={{ strokeWidth: 1.9 }} d="M0 0H5L0 6H5" /></g>
        <g transform="translate(67 2) scale(.72)"><path className="sb-line sb-z sb-z2" style={{ strokeWidth: 1.9 }} d="M0 0H5L0 6H5" /></g>
        <g transform="translate(7 12)"><path className="sb-line sb-sparkle" style={{ strokeWidth: 2 }} d="M0-3.4V3.4M-3.4 0H3.4" /></g>
        <g transform="translate(66 8) scale(.8)"><path className="sb-line sb-sparkle sb-spark2" style={{ strokeWidth: 2 }} d="M0-3.4V3.4M-3.4 0H3.4" /></g>
      </g>
    </svg>
  );
}

class BuddyBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("ScoutBuddy fell back to the plain mark", err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ScoutBuddy(props: BuddyProps) {
  const { size = "sm", className, label, replay = 0 } = props;
  return (
    <BuddyBoundary fallback={<AdminMark className={cn("text-current", SIZE_CLASS[size], className)} label={label} />}>
      <BuddyInner key={replay} {...props} />
    </BuddyBoundary>
  );
}
