import { useMemo, useRef } from "react";
import {
  AudioLines, BookOpen, Bot, Brush, Briefcase, CalendarCheck, Car, ClipboardCheck, Clapperboard, Cookie, Cpu,
  Database, Dog, Eye, GraduationCap, Hammer, HandHeart, House, Wifi, Image, Inbox, KeyRound, Laptop,
  Lightbulb, LineChart, Mail, MailPlus, Mails, Megaphone, MessageCircle, MessageSquareShare, Mic,
  Moon, Network, NotebookPen, PenLine, PhoneCall, PlaneLanding, Repeat, ScanEye, Search, Send,
  SendHorizontal, Server, ShieldCheck, Siren, Sparkles, SprayCan, Trash2, UserPlus, Users, Wrench, Compass,
  GalleryHorizontal, HandHelping, Handshake, Bell, PiggyBank, HeartPulse, Tv, Coffee, ClipboardList, SquareCheckBig,
  type LucideIcon,
} from "lucide-react";
import { ADMIN_MARK_PERIOD_MS, useStare } from "@/components/AdminMark";
import { cn } from "@/lib/utils";

/**
 * Bot mascots: every bot on the Team page drawn like Scout's binoculars — one line drawing at Scout's stroke
 * weight, with dot eyes (three set sizes, each with a small highlight) that glance and blink on Scout's 3.2s
 * beat and stare at the pointer when it comes near.
 *
 * Motion follows Apple HIG via the ui-ux-pro-max pass (2026-10-04): at rest only the eyes move, like Scout. Each
 * bot's own move (bulb glows, plane bobs, dog wags) plays when its card is hovered or focused — an element with
 * data-bm-host — or always for new hires and in the welcome-email GIFs (moveOn="always"). Moves use a spring
 * curve and start right away. Sleeping (paused, switched off, not built yet): eyes closed, no motion.
 * Reduced motion: everything still.
 *
 * The body is the lucide icon for the bot (bestly_agents.icon), drawn at 3x in Scout's 72-unit grid, so
 * stroke 1.85 there = Scout's 5.5. The eyes punch a small hole in the lines so they never collide with them.
 */

/** Tamagotchi moods from real signals (team_mood_state, see 20261004200000_team_moods_strikes.sql). */
export type Mood = "happy" | "stressed" | "overworked" | "sick" | "bored" | "unknown" | "asleep" | "striking";

type Move = "bob" | "tilt" | "pulse" | "wag" | "flash" | "hop" | "sway" | "none";
type Spec = {
  Icon: LucideIcon;
  /** eye-pair centre in the 72 grid, half the distance between the eyes, eye radius */
  x: number; y: number; gap: number; r?: number;
  /** one big eye instead of two (eye-shaped icons) */
  one?: boolean;
  move?: Move;
};

export const MASCOTS: Record<string, Spec> = {
  lightbulb:            { Icon: Lightbulb, x: 36, y: 25, gap: 7.8, move: "pulse" },
  "user-plus":          { Icon: UserPlus, x: 27, y: 22, gap: 5.0, r: 5.5, move: "hop" },
  users:                { Icon: Users, x: 27, y: 22, gap: 5.0, r: 5.5, move: "sway" },
  send:                 { Icon: Send, x: 27, y: 30, gap: 6.2, r: 5.9, move: "bob" },
  "send-horizontal":    { Icon: SendHorizontal, x: 27, y: 36, gap: 6.2, r: 5.9, move: "bob" },
  mails:                { Icon: Mails, x: 45, y: 37, gap: 6.7, r: 6.2, move: "bob" },
  mail:                 { Icon: Mail, x: 36, y: 45, gap: 7.8, move: "bob" },
  "mail-plus":          { Icon: MailPlus, x: 30, y: 45, gap: 6.7, r: 6.2, move: "bob" },
  inbox:                { Icon: Inbox, x: 36, y: 25, gap: 7.8, move: "bob" },
  "graduation-cap":     { Icon: GraduationCap, x: 36, y: 46, gap: 7.8, move: "tilt" },
  moon:                 { Icon: Moon, x: 25, y: 44, gap: 5.6, r: 5.9, move: "sway" },
  hammer:               { Icon: Hammer, x: 47, y: 21, gap: 5.6, r: 5.5, move: "tilt" },
  briefcase:            { Icon: Briefcase, x: 36, y: 40, gap: 9.0, move: "bob" },
  mic:                  { Icon: Mic, x: 36, y: 22, gap: 5.2, r: 5.5, move: "pulse" },
  dog:                  { Icon: Dog, x: 36, y: 43, gap: 13.4, move: "wag" },
  "audio-lines":        { Icon: AudioLines, x: 36, y: 36, gap: 9.0, move: "pulse" },
  "message-circle":     { Icon: MessageCircle, x: 36, y: 36, gap: 7.8, move: "bob" },
  "message-square-share": { Icon: MessageSquareShare, x: 30, y: 40, gap: 6.7, r: 6.2, move: "bob" },
  laptop:               { Icon: Laptop, x: 36, y: 31, gap: 7.8, move: "none" },
  projector:            { Icon: Tv, x: 36, y: 44, gap: 8, move: "flash" },
  sparkles:             { Icon: Sparkles, x: 31, y: 37, gap: 5.2, r: 5.5, move: "pulse" },
  "key-round":          { Icon: KeyRound, x: 45, y: 26, gap: 5.6, r: 5.9, move: "tilt" },
  "plane-landing":      { Icon: PlaneLanding, x: 40, y: 30, gap: 5.6, r: 5.5, move: "bob" },
  "hand-heart":         { Icon: HandHeart, x: 48, y: 22, gap: 5.0, r: 5.2, move: "pulse" },
  siren:                { Icon: Siren, x: 36, y: 42, gap: 6.7, r: 6.2, move: "flash" },
  "clipboard-check":    { Icon: ClipboardCheck, x: 36, y: 31, gap: 7.8, move: "tilt" },
  repeat:               { Icon: Repeat, x: 36, y: 36, gap: 7.8, move: "tilt" },
  "calendar-check":     { Icon: CalendarCheck, x: 36, y: 40, gap: 9.0, move: "hop" },
  house:                { Icon: House, x: 36, y: 29, gap: 6.7, r: 6.2, move: "none" },
  "house-wifi":         { Icon: Wifi, x: 36, y: 52, gap: 6.7, r: 5.5, move: "flash" },
  "list-checks":        { Icon: SquareCheckBig, x: 30, y: 23, gap: 7, r: 4.6, move: "hop" },
  "list-todo":          { Icon: ClipboardList, x: 36, y: 25, gap: 7, r: 4.6, move: "hop" },
  landmark:             { Icon: PiggyBank, x: 43, y: 31, gap: 6.5, r: 4.6, move: "hop" },
  cpu:                  { Icon: Cpu, x: 36, y: 36, gap: 5.6, r: 5.2, move: "pulse" },
  database:             { Icon: Database, x: 36, y: 47, gap: 9.0, move: "bob" },
  sunrise:              { Icon: Coffee, x: 30, y: 42, gap: 7.5, move: "hop" },
  "notebook-pen":       { Icon: NotebookPen, x: 28, y: 36, gap: 6.7, r: 5.9, move: "tilt" },
  "book-open":          { Icon: BookOpen, x: 36, y: 33, gap: 15.7, move: "sway" },
  car:                  { Icon: Car, x: 33, y: 39, gap: 6.7, r: 6.2, move: "bob" },
  "phone-call":         { Icon: PhoneCall, x: 26, y: 40, gap: 5.6, r: 5.5, move: "wag" },
  brush:                { Icon: Brush, x: 20, y: 54, gap: 5.0, r: 5.2, move: "wag" },
  "spray-can":          { Icon: SprayCan, x: 45, y: 48, gap: 5.6, r: 5.5, move: "hop" },
  "shield-check":       { Icon: ShieldCheck, x: 36, y: 27, gap: 7.3, move: "none" },
  search:               { Icon: Search, x: 33, y: 33, gap: 7.8, move: "tilt" },
  image:                { Icon: Image, x: 42, y: 25, gap: 6.7, r: 5.9, move: "none" },
  "gallery-horizontal": { Icon: GalleryHorizontal, x: 36, y: 36, gap: 6.7, r: 5.9, move: "sway" },
  "pen-line":           { Icon: PenLine, x: 38, y: 26, gap: 5.0, r: 5.2, move: "wag" },
  "trash-2":            { Icon: Trash2, x: 36, y: 31, gap: 7.8, r: 5.9, move: "hop" },
  eye:                  { Icon: Eye, x: 36, y: 36, gap: 0, r: 9, one: true, move: "none" },
  "scan-eye":           { Icon: ScanEye, x: 36, y: 36, gap: 0, r: 8.1, one: true, move: "none" },
  cookie:               { Icon: Cookie, x: 33, y: 31, gap: 8.4, move: "tilt" },
  activity:             { Icon: HeartPulse, x: 36, y: 22, gap: 8.5, r: 5.6, move: "pulse" },
  server:               { Icon: Server, x: 44, y: 18, gap: 5.6, r: 5.2, move: "flash" },
  "line-chart":         { Icon: LineChart, x: 30, y: 26, gap: 5.6, r: 5.5, move: "hop" },
  clapperboard:         { Icon: Clapperboard, x: 36, y: 47, gap: 9.0, move: "wag" },
  ladder:               { Icon: Network, x: 36, y: 15, gap: 4.5, r: 4.9, move: "hop" },
  wrench:               { Icon: Wrench, x: 40, y: 31, gap: 5.6, r: 5.2, move: "tilt" },
  megaphone:            { Icon: Megaphone, x: 33, y: 33, gap: 5.6, r: 5.5, move: "pulse" },
  compass:              { Icon: Compass, x: 36, y: 52, gap: 8.4, r: 5.7, move: "tilt" },
  "hand-helping":       { Icon: HandHelping, x: 44, y: 30, gap: 5.6, r: 5.5, move: "bob" },
  handshake:            { Icon: Handshake, x: 36, y: 24, gap: 7, r: 5, move: "wag" },
  bell:                 { Icon: Bell, x: 36, y: 30, gap: 7, r: 5.4, move: "wag" },
  bot:                  { Icon: Bot, x: 36, y: 42, gap: 9, r: 5.6, move: "bob" },   // sits exactly on the glyph's own eyes
};

/* Keyframes share Scout's 3.2s period and phase (index.html .am-* classes), so the crew looks around together. */
const CSS = `
.bm-look,.bm-blink{animation-duration:3.2s;animation-iteration-count:infinite;animation-delay:var(--bm-delay,0ms)}
.bm-look{transform-box:view-box;animation-name:bm-look;animation-timing-function:cubic-bezier(.45,1.5,.5,1)}
.bm-blink{transform-box:fill-box;transform-origin:center;animation-name:bm-blink;animation-timing-function:ease-in-out}
@keyframes bm-look{0%,8%{transform:translate(0,0)}14%{transform:translate(0,.6px)}22%,42%{transform:translate(-2.2px,1.1px)}52%,72%{transform:translate(2.2px,1.1px)}82%,100%{transform:translate(0,0)}}
@keyframes bm-blink{0%,87%{transform:scaleY(1)}91%{transform:scaleY(.12)}95%,100%{transform:scaleY(1)}}
.bm-move{transform-box:view-box;transform-origin:36px 36px;animation-duration:3.2s;animation-iteration-count:infinite;animation-timing-function:cubic-bezier(.34,1.56,.64,1)}
.bm-always .bm-move{animation-name:var(--bm-anim);animation-delay:var(--bm-delay,0ms)}
[data-bm-host]:hover .bm-move,[data-bm-host]:focus-visible .bm-move{animation-name:var(--bm-anim);animation-delay:0ms}
.bm-bob{--bm-anim:bm-bob}@keyframes bm-bob{0%{transform:translateY(0)}14%{transform:translateY(-2.8px)}30%,100%{transform:translateY(0)}}
.bm-hop{--bm-anim:bm-hop}@keyframes bm-hop{0%{transform:translateY(0)}9%{transform:translateY(-4.5px)}17%{transform:translateY(.8px)}24%,100%{transform:translateY(0)}}
.bm-tilt{--bm-anim:bm-tilt}@keyframes bm-tilt{0%{transform:rotate(0)}12%{transform:rotate(-6deg)}26%{transform:rotate(5deg)}38%,100%{transform:rotate(0)}}
.bm-sway{--bm-anim:bm-sway}@keyframes bm-sway{0%{transform:rotate(0)}15%{transform:rotate(-4deg)}32%{transform:rotate(3deg)}45%,100%{transform:rotate(0)}}
.bm-wag{--bm-anim:bm-wag;transform-origin:36px 60px}@keyframes bm-wag{0%{transform:rotate(0)}6%{transform:rotate(-7deg)}12%{transform:rotate(7deg)}18%{transform:rotate(-5deg)}24%{transform:rotate(3deg)}30%,100%{transform:rotate(0)}}
.bm-pulse{--bm-anim:bm-pulse}@keyframes bm-pulse{0%{transform:scale(1);filter:none}16%{transform:scale(1.07);filter:drop-shadow(0 0 3px currentColor)}36%,100%{transform:scale(1);filter:none}}
.bm-flash{--bm-anim:bm-flash}@keyframes bm-flash{0%,12%,24%,100%{opacity:1;filter:none}6%,18%{opacity:.55;filter:drop-shadow(0 0 4px currentColor)}}
.bm-watching .bm-look,.bm-watching .bm-blink{animation:none;transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.bm-asleep .bm-move{animation:none!important}
.bm-sweat{transform-box:fill-box;transform-origin:top center;animation:bm-sweat 2.4s cubic-bezier(.5,0,.75,0) infinite}
@keyframes bm-sweat{0%,55%{transform:translateY(0) scale(1);opacity:1}90%{transform:translateY(6px) scale(.9);opacity:0}91%{transform:translateY(-1px) scale(.6);opacity:0}100%{transform:translateY(0) scale(1);opacity:1}}
.bm-queasy{transform-box:view-box;transform-origin:36px 60px;animation:bm-queasy 4.8s ease-in-out infinite}
@keyframes bm-queasy{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(2.5deg)}}
.bm-shake{transform-box:view-box;transform-origin:36px 36px;animation:bm-shake 1.6s ease-in-out infinite}
@keyframes bm-shake{0%,60%,100%{transform:translateX(0)}65%{transform:translateX(-1.2px)}72%{transform:translateX(1.2px)}79%{transform:translateX(-.8px)}86%{transform:translateX(.6px)}}
.bm-stomp{transform-box:view-box;transform-origin:36px 66px;animation:bm-stomp 1.6s cubic-bezier(.34,1.56,.64,1) infinite}
@keyframes bm-stomp{0%,100%{transform:translateY(0)}20%{transform:translateY(-3px)}40%{transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.bm-look,.bm-blink,.bm-move,.bm-sweat,.bm-queasy,.bm-shake,.bm-stomp{animation:none!important}.bm-watching .bm-look{transition:none}}
`;
if (typeof document !== "undefined" && !document.getElementById("bm-css")) {
  const el = document.createElement("style");
  el.id = "bm-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

const EYE_SIZES = [4.6, 5.6, 6.6];

export function hasMascot(icon: string | null | undefined) {
  return !!icon && icon in MASCOTS;
}

function hash(s: string) {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function BotMascot({
  icon,
  seed = "",
  asleep = false,
  dead = false,
  mood = "happy",
  watchCursor = true,
  moveOn = "hover",
  className,
  label,
}: {
  icon: string | null | undefined;
  /** spreads blinks a little so the whole chart doesn't blink in perfect unison */
  seed?: string;
  /** paused, switched off or not built yet: eyes closed, no motion */
  asleep?: boolean;
  /** let go (the Graveyard): X eyes, no motion */
  dead?: boolean;
  /** how it's doing: changes the eyes, adds a sweat drop or brows, and a mood motion that replaces its own move */
  mood?: Mood;
  watchCursor?: boolean;
  /** "hover": its own move plays while a parent [data-bm-host] is hovered/focused (calm at rest).
   *  "always": keeps playing (new hires, welcome-email GIFs). */
  moveOn?: "hover" | "always";
  className?: string;
  label?: string;
}) {
  const spec = (icon && MASCOTS[icon]) || MASCOTS.bot;
  if (mood === "asleep") asleep = true;
  const plainEyes = !dead && !asleep && (mood === "happy" || mood === "unknown" || mood === "stressed" || mood === "striking");
  const ref = useRef<SVGSVGElement>(null);
  // three eye sizes only (small / medium / large), like a type scale; a single big eye keeps its own size
  const r = spec.one ? spec.r ?? 8 : EYE_SIZES.reduce((a, b) => (Math.abs(b - (spec.r ?? 6.6)) < Math.abs(a - (spec.r ?? 6.6)) ? b : a));
  const stare = useStare(ref, watchCursor && plainEyes, { x: spec.one ? 2.6 : 2.4, y: 1.8 }, spec.y / 72);
  const delay = useMemo(() => {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    return `-${Math.round((now + (hash(seed) % 600)) % ADMIN_MARK_PERIOD_MS)}ms`;
  }, [seed]);
  const uid = useMemo(() => `bm${hash(seed + (icon ?? ""))}${Math.round(Math.random() * 1e6)}`, [seed, icon]);
  const gap = Math.max(spec.gap, r * 1.6);   // eyes never touch
  const eyes = spec.one ? [spec.x] : [spec.x - gap, spec.x + gap];
  const { Icon } = spec;
  // a mood motion replaces the bot's own move: sick sways queasily, overworked trembles, strikers stomp
  const moodMove = dead || asleep ? "" : mood === "sick" ? "bm-queasy" : mood === "overworked" ? "bm-shake" : mood === "striking" ? "bm-stomp" : "";
  const move = moodMove || (asleep || dead || mood === "bored" || !spec.move || spec.move === "none" ? "" : `bm-move bm-${spec.move}`);
  const sw = Math.max(2.4, r * 0.44);
  const top = spec.y - r;
  // sweat drop sits above the outer eye, clear of the line drawing's mask
  const dropX = (spec.one ? spec.x + r * 1.3 : spec.x + gap + r * 1.15);
  const dy = top - 3;   // drop: tip at dy - 8, bowl bottom at dy + 2.4
  const dropD = `M${dropX} ${dy - 8}C${dropX + 3.8} ${dy - 2.6} ${dropX + 4.6} ${dy + 0.8} ${dropX} ${dy + 2.4}C${dropX - 4.6} ${dy + 0.8} ${dropX - 3.8} ${dy - 2.6} ${dropX} ${dy - 8}Z`;
  const sweat = !dead && !asleep && (mood === "stressed" || mood === "overworked");
  // angry brows, slanting down toward the middle
  const brows = !dead && !asleep && mood === "striking"
    ? eyes.map((x, i) => {
        const dir = spec.one ? 0 : i === 0 ? 1 : -1;
        return `M${x - r * 1.1} ${top - 3.2 - dir * 1.6}L${x + r * 1.1} ${top - 3.2 + dir * 1.6}`;
      })
    : [];
  const look = stare ? { transform: `translate(${stare.x}px, ${stare.y}px)` } : undefined;
  const squint = stare ? { transform: "scaleY(.78)" } : undefined;

  return (
    <svg
      ref={ref}
      viewBox="0 0 72 72"
      className={cn("select-none overflow-visible", moveOn === "always" && "bm-always", stare && "bm-watching", (asleep || dead) && "bm-asleep", className)}
      style={{ ["--bm-delay" as string]: delay } as React.CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <mask id={uid} maskUnits="userSpaceOnUse" x="-8" y="-8" width="88" height="88">
          <rect x="-8" y="-8" width="88" height="88" fill="#fff" />
          {eyes.map((x) => <circle key={x} cx={x} cy={spec.y} r={r + 2} fill="#000" />)}
          {brows.map((d) => <path key={d} d={d} fill="none" stroke="#000" strokeWidth={sw * 0.85 + 4} strokeLinecap="round" />)}
          {sweat && <path d={dropD} fill="#000" stroke="#000" strokeWidth={4} strokeLinejoin="round" />}
        </mask>
        {/* catchlight: a small highlight knocked out of each pupil, upper left (moves and blinks with the eye) */}
        {eyes.map((x, i) => (
          <mask key={x} id={`${uid}e${i}`} maskUnits="userSpaceOnUse" x="-8" y="-8" width="88" height="88">
            <rect x="-8" y="-8" width="88" height="88" fill="#fff" />
            <circle cx={x - r * 0.34} cy={spec.y - r * 0.36} r={r * 0.3} fill="#000" />
          </mask>
        ))}
      </defs>
      <g className={move}>
        <g mask={`url(#${uid})`}>
          <Icon width={72} height={72} strokeWidth={1.85} absoluteStrokeWidth={false} />
        </g>
        {dead ? (
          eyes.map((x) => {
            const d = r * 0.85;
            return (
              <path key={x} d={`M${x - d} ${spec.y - d}L${x + d} ${spec.y + d}M${x + d} ${spec.y - d}L${x - d} ${spec.y + d}`}
                fill="none" stroke="currentColor" strokeWidth={Math.max(2.4, r * 0.5)} strokeLinecap="round" />
            );
          })
        ) : !asleep && mood === "bored" ? (
          // flat-line eyes: nothing to do
          eyes.map((x) => (
            <path key={x} d={`M${x - r} ${spec.y}L${x + r} ${spec.y}`} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
          ))
        ) : !asleep && mood === "overworked" ? (
          // squeezed > < eyes: straining
          eyes.map((x, i) => {
            const d = r * 0.9, dir = spec.one ? 1 : i === 0 ? 1 : -1;
            return (
              <path key={x} d={`M${x - d * dir} ${spec.y - d * 0.8}L${x + d * dir * 0.7} ${spec.y}L${x - d * dir} ${spec.y + d * 0.8}`}
                fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
            );
          })
        ) : !asleep && mood === "sick" ? (
          // heavy lids: the lower half of each eye under a flat lid
          eyes.map((x) => (
            <g key={x}>
              <path d={`M${x - r} ${spec.y + 0.4}A${r} ${r} 0 0 0 ${x + r} ${spec.y + 0.4}Z`} fill="currentColor" />
              <path d={`M${x - r - 1} ${spec.y - 0.6}L${x + r + 1} ${spec.y - 0.6}`} fill="none" stroke="currentColor" strokeWidth={sw * 0.8} strokeLinecap="round" />
            </g>
          ))
        ) : asleep ? (
          eyes.map((x) => (
            <path key={x} d={`M${x - r} ${spec.y - 0.6}Q${x} ${spec.y + r * 1.1} ${x + r} ${spec.y - 0.6}`}
              fill="none" stroke="currentColor" strokeWidth={Math.max(2.4, r * 0.44)} strokeLinecap="round" />
          ))
        ) : (
          <g className="bm-look" style={look}>
            {eyes.map((x, i) => (
              <g key={x} className="bm-blink" style={squint}>
                <circle cx={x} cy={spec.y} r={r} fill="currentColor" mask={`url(#${uid}e${i})`} />
              </g>
            ))}
          </g>
        )}
        {brows.map((d) => <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={sw * 0.85} strokeLinecap="round" />)}
      </g>
      {sweat && (
        <path className="bm-sweat" d={dropD} fill="#64D2FF" stroke="none" />
      )}
    </svg>
  );
}
