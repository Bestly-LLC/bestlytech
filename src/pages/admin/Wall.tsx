/**
 * /admin/wall - remote for the Bestly Wall, the projector strip above Jared's desk
 * (Nebula Capsule 3 on Google TV, driven by bestly-pi). Behind the admin passkey sign-in.
 *
 * Two paths to the Pi, so dragging feels instant and nothing is ever lost:
 *   1. Live: every change is broadcast on a Supabase Realtime topic the Pi listens to
 *      (~100 ms). The topic name comes from wall_admin_get(), admin only.
 *   2. Saved: the same change is written with wall_admin_set / wall_admin_power
 *      (throttled while dragging). The Pi re-reads it as a backup and after restarts.
 * Status comes from the Pi watchdog every minute. See bestly_memory house/wall/projector-strip-v1.
 *
 * Layout follows Apple's HIG: grouped inset sections, one control per job
 * (segmented control, switches, stepper-style nudge pad), 44 pt targets, plain-language labels.
 * Order is answer-first: a Now card (status, mode, what's playing, 4 quick actions), then daily
 * controls, then Live Activities, and an Advanced disclosure for alignment, sky fit, power tools and tests.
 * Every action confirms with a toast (sonner, one at a time).
 *
 * Deep links (iPhone Live Activities open these): #sleep, #show, #live, #theme scroll to that section
 * once the page has loaded, opening any collapsed disclosure that holds it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { ProjectorHealth, type Health } from "@/components/admin/ProjectorHealth";
import { WallRadioSection, type WallRadio, type WallRadioLive } from "@/components/admin/WallRadio";
import { WallPowerCost, type WallPowerMeter } from "@/components/admin/WallPowerCost";
import { WallLedSign, type LedSign, type LedSignHealth } from "@/components/admin/WallLedSign";
import { Group, Row, Segmented, btn, btnPrimary, swHit, NW } from "@/components/admin/wallUi";
import { DndCard, MotivateButton, PackagesCard, type Dnd } from "@/components/admin/WallR4";
import { VoiceCard, type Voice } from "@/components/admin/WallVoice";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, Loader2, Moon, MoonStar, Focus, Maximize2, Minimize2, PenLine, RotateCw, Plane, Nfc, Sparkles, Copy, UserRound, Volume2, EyeOff, Eye, Projector, RotateCcw, Sun, Trash2, Triangle, WifiOff, PartyPopper, Square, Presentation, VolumeX, Airplay, Clapperboard, Ghost, Skull, Power, ChevronDown, Car, CalendarClock, Leaf, Undo2, Redo2, Lock, Check, Minus, Plus, RadioTower } from "lucide-react";

/** Left-side strip widgets (state.widgets). Each hides by itself when it has nothing to show. */
type StripWidget = "news" | "mail" | "turo$" | "air" | "energy" | "habits" | "leo" | "appstore" | "devices";
const STRIP_WIDGETS: { id: StripWidget; label: string; detail: string }[] = [
  { id: "news", label: "News", detail: "Headlines from NPR and Ground News, one at a time." },
  { id: "turo$", label: "Turo earnings", detail: "This week, today, and the next payout." },
  { id: "air", label: "Air quality and pollen", detail: "AQI, pollen and UV for home." },
  { id: "energy", label: "Home energy", detail: "What the wall setup uses right now, today and this month." },
  { id: "mail", label: "Mail and deliveries", detail: "Paper mail this week and packages on the way." },
  { id: "habits", label: "Activity", detail: "Steps, Move, Exercise, Stand and your streak." },
  { id: "leo", label: "Leo today", detail: "A one-line daily horoscope." },
  { id: "appstore", label: "App Store", detail: "Where each app stands with Apple." },
  { id: "devices", label: "Devices", detail: "Right side, after Batteries: the Dyson purifier (indoor air, fan, filter)." },
];

type Pt = [number, number];
type LiveKind = "plane" | "sweep" | "turo" | "show" | "sleep" | "incident";
type Mode = "auto" | "board" | "ambient" | "demo" | "off";
/** Values of the wall state key `theme` (null = Normal). A new theme adds its value here, to THEMES,
 *  to server.py's theme check, to wall_clean_tour, and to wall.html. */
type ThemeId = "halloween" | "thanksgiving";
type WallState = {
  corners: Pt[]; mode: Mode; one: string; mapping: boolean;
  testSweep: boolean; testScout: boolean; away: boolean; mask: Pt[] | null;
  autoKeystone?: boolean;
  demoLeft?: string; demoNames?: string; demoRight?: string;
  wing?: Pt[]; signShow?: "auto" | "on" | "off"; signNear?: number | null; sound?: boolean;
  soundPack?: "glass" | "marimba" | "keys"; soundTest?: number | null;
  air?: Pt[]; airShow?: boolean; skyStars?: boolean; skyStarLabels?: boolean; skyGrid?: boolean; presence?: boolean; skyMoon?: boolean; skySun?: boolean; skyPlanets?: boolean; airLabels?: boolean; airLabelsSmall?: boolean; airCard?: boolean; airCardHeli?: boolean; airCardPin?: boolean; leftDate?: boolean; radio?: WallRadio; tour?: { cmd: "play" | "party" | "stop" | "skit" | "hshow" | "hparty"; at: number } | null; theme?: ThemeId | null; volume?: number | null; airplay?: boolean;
  alarm?: { on: boolean; time: string; days?: "once" | "weekdays" | "weekends" | "daily"; vol?: number; label?: string; set_at?: number; stop?: number; test?: number } | null;
  heads?: { id: string; at: number; title: string; sub?: string; sound?: boolean; vol?: number; soon?: number }[] | null; headsStop?: number | null; tripDismiss?: { id: string; at: number } | null; airKey?: boolean; airBearing?: number; calGrid?: boolean;
  /** W1 round 3 (sky): Space Station name tag, home marker, sky radius in miles (2-25), live LAX tower audio. */
  issTag?: boolean; skyHome?: boolean; airRadiusMi?: number; atc?: boolean;
  /** Landmarks overlay on the sky map: city labels, downtown skyline glyph, LAX runways (2026-10-01). Missing = on. */
  skyLandmarks?: boolean;
  /** OSM roads on the sky map (dense grid near home, freeways across the basin; 2026-10-02). Missing = on. */
  skyRoads?: boolean;
  /** TomTom congestion colors over the roads (Pi caches flow tiles; needs .tomtom_key on the Pi; 2026-10-02). Missing = on. */
  skyTraffic?: boolean;
  /** W1 round 4: where home sits on the sky (0..1 of the sky box; null = middle) and a plane held on the sign-wall name tag. */
  homePos?: { x: number; y: number } | null; airFocus?: { hex: string; until: number } | null;
  /** Strip widgets on the left side (missing = on) and the sample Turo booking pop-up (ms). W2 round 3. */
  widgets?: Partial<Record<StripWidget, boolean>> | null; bookingDemo?: number | null;
  fxPlay?: { name: "show" | "wake" | "sleep"; at: number } | null;
  sleepShow?: { at: number; mins: number; music?: boolean } | null;
  liveActs?: Partial<Record<LiveKind, boolean>> | null;
  /** W8 round 4: projection-mapped neon sign (glow look, color, fine-align, alert animations, test play). */
  ledSign?: LedSign | null;
  /** W4 round 4: Do Not Disturb, the layout block the projector outlines while the grid is on, and Motivate me (W5 plays it). */
  voice?: Voice | null;   // W7 round 4: Hey Scout
  dnd?: Dnd | null; layoutSel?: "corners" | "mask" | "wing" | "air" | null; motivate?: { seq: number; ts: number } | null;
};
/** One undo step from wall_geometry_history_list (newest first). can_undo / can_redo mark the next step each way. */
type GeoStep = { id: number; at: string; reason: string; can_undo: boolean; can_redo: boolean; undone: boolean; who?: string | null };
/** The keys undo/redo put back together (same list as the DB's wall_geo_keys()). */
const GEO_KEYS = ["corners", "mask", "air", "wing", "airAspect", "airRot", "airBearing"] as const;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** "4:59 PM" today, "Sep 26, 4:59 PM" before that. Empty when the label already says the time. */
const stepTime = (st: GeoStep) => {
  if (/\d:\d\d\s?[AP]M/i.test(st.reason)) return "";
  const d = new Date(st.at);
  const t = time12(d.getTime());
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${t}`;
};

/** ⌘Z / ⇧⌘Z (Ctrl on Windows) while the alignment tool is on screen. Leaves typing fields alone. */
function UndoKeys({ onUndo, onRedo }: { onUndo: () => void; onRedo: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && !(k === "y" && !isMac)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (k === "y" || e.shiftKey) onRedo(); else onUndo();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onUndo, onRedo]);
  return null;
}

type OneInfo = { text: string; kind: string | null; source: string | null; why: string | null; checked_at: string | null; changed_at: string | null; error: string | null };
type Sig = { id: number; name: string; color: string; hidden: boolean; test: boolean; at: string; emoji?: string | null };
const DEFAULT_WING: Pt[] = [[0.02, 0.33], [0.27, 0.36], [0.27, 0.66], [0.02, 0.70]];
const DEFAULT_AIR: Pt[] = [[0.30, 0.17], [0.99, 0.05], [0.99, 0.25], [0.30, 0.37]];
type DemoKey = "demoLeft" | "demoNames" | "demoRight";
const DEMO_FIELDS: { key: DemoKey; label: string; placeholder: string; lines: number; fallback: string }[] = [
  { key: "demoLeft", label: "Left", placeholder: "Oct 18\n2026", lines: 2, fallback: "Oct 18\n2026" },
  { key: "demoNames", label: "Middle", placeholder: "Maya & Jordan", lines: 1, fallback: "Maya & Jordan" },
  { key: "demoRight", label: "Right", placeholder: "Welcome\nfriends", lines: 2, fallback: "Welcome\nfriends" },
];
type PiStatus = {
  status?: string; top?: string; cpu_c?: number | null; heartbeat_age_s?: number | null;
  override?: { on: boolean; until: number } | null; restarts_1h?: number; sync_age_s?: number | null;
  health?: Health | null;
  /** Turo handoff card on the wall (server.py trip_loop): RETRIEVE = transit to get the car, DELIVER = drive it there. */
  trip?: { active?: boolean; id?: string; kind?: "retrieve" | "deliver"; phase?: string; title?: string; line?: string;
    test?: boolean; fresh_age_s?: number | null; err?: string | null } | null;
  page_mode?: string | null; dark_30m?: number; last_dark?: { at: number; why: string } | null;
  airplay?: { want?: boolean; on?: boolean; casting?: boolean; kind?: string | null; since?: number | null; err?: string | null;
    age_s?: number | null; page?: string | null; rtc?: string | null } | null;
  radio?: WallRadioLive;
  /** Dashboard electricity meter (server.py power_loop): projector + Pi watts and measured kWh. */
  power_meter?: WallPowerMeter | null;
  /** Sign-wall focus preset (server.py focus_command): manual steps added after autofocus. */
  focus?: { offset?: number; tuned?: boolean; busy?: boolean; err?: string | null; last?: { cmd: string; at: number; ok: boolean } | null } | null;
};
type Remote = {
  state: WallState; version: number; channel: string; power: { on?: boolean; seq: number; at?: string };
  status: PiStatus | null; status_at: string | null; pulled_at: string | null;
  issues: { key: string; title: string; severity: string; needs: string | null; opened_at: string }[];
};

const DEFAULT_CORNERS: Pt[] = [[0.05, 0.40], [0.95, 0.40], [0.95, 0.55], [0.05, 0.55]];
const MODES: { id: Mode; label: string; about: string }[] = [
  { id: "auto", label: "Auto", about: "Board 7\u00a0AM–9\u00a0PM, ambient color 9\u00a0PM–midnight. The projector sleeps midnight–7\u00a0AM." },
  { id: "board", label: "Board", about: "Clock, the one thing, Turo, home and Scout, all day." },
  { id: "ambient", label: "Ambient", about: "Slow color wash with a small clock. Good for evenings." },
  { id: "demo", label: "Demo", about: "Sample wedding welcome to show clients what the service looks like." },
  { id: "off", label: "Black", about: "Projects nothing. The light stays on; use Sleep to turn it off." },
];

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

const secsAgo = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)) : null);
const agoText = (s: number | null) =>
  s == null ? "never" : s < 10 ? "just now" : s < 60 ? `${s}\u00a0sec ago` : s < 3600 ? `${Math.round(s / 60)}\u00a0min ago` : `${Math.round(s / 3600)}\u00a0hr ago`;
const time12 = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const toF = (c: number) => Math.round((c * 9) / 5 + 32);

/* building blocks (Group, Row, Segmented, btn, ...) live in components/admin/wallUi.tsx */

const TOUR_NAME = { play: "The show", party: "The party", skit: "The skit", hshow: "The Halloween show", hparty: "The Halloween party", stop: "Stop" } as const;

/** iPhone Live Activities the wall server drives. State key liveActs; a missing kind means on. */
const LIVE_ACTS: { id: LiveKind; label: string; detail: string; icon: React.ElementType }[] = [
  { id: "plane", label: "Nearby aircraft", detail: "Airline, flight, route, altitude and speed of the plane overhead.", icon: Plane },
  { id: "sweep", label: "Move the car", detail: "Countdown to street sweeping.", icon: Car },
  { id: "turo", label: "Turo trips", detail: "Countdown to the next pickup or return.", icon: CalendarClock },
  { id: "show", label: "Show for friends", detail: "Timer while the show or party is on.", icon: PartyPopper },
  { id: "sleep", label: "Sleep mode", detail: "Counting-sheep countdown to lights out.", icon: Moon },
  { id: "incident", label: "Something's broken", detail: "A red card while a serious problem is open.", icon: AlertTriangle },
];

/** Options for the Theme control. "normal" writes theme: null. Add a new theme's value here once the Pi supports it. */
const THEMES: { id: "normal" | ThemeId; label: string; detail: string }[] = [
  { id: "normal", label: "Normal", detail: "The everyday wall." },
  { id: "halloween", label: "Halloween", detail: "Spooky type, bats, a spider, a jack-o'-lantern and a Halloween countdown." },
  { id: "thanksgiving", label: "Thanksgiving", detail: "Warm harvest colors, falling leaves, a turkey on the strip, geese crossing the ceiling, and a Thanksgiving countdown." },
];
const THEME_ICON: Partial<Record<"normal" | ThemeId, React.ElementType>> = { halloween: Ghost, thanksgiving: Leaf };

/** Copied by "Add a new theme". The idea Jared types goes after the last line. */
const NEW_THEME_PROMPT = `Build a new theme for the Bestly Wall, end to end, and ship it.

Context
- The Bestly Wall is projected onto the wall and ceiling above my desk by an Anker Nebula Capsule 3 projector (Google TV).
- The Raspberry Pi at \`ssh bestly-pi-lan\` runs it from /opt/bestly/wall: server.py (state and API), watchdog.py (health checks and auto-recovery), and www/wall.html (the page the projector shows).
- Wall state lives in Supabase project rcqfqhguwpmaarseifqg, table wall_state.
- The remote is the admin page at bestly.tech/admin/wall (src/pages/admin/Wall.tsx in ~/Developer/bestlytech-wall; push to origin main).

How themes work today
- Each theme is a value of the wall state key \`theme\`: "halloween" and "thanksgiving" today. null means Normal.
- server.py validates it with a check like: if k == "theme" and v not in (None, "halloween", "thanksgiving")
- The database function wall_clean_tour (not wall_clean_patch) must accept the value too.
- A new theme needs its new value added in all three places (wall.html, server.py, wall_clean_tour), plus a new option in the admin page's Theme control (the THEMES list in Wall.tsx).
- In wall.html, themeSync() sets body[data-theme]; theme styling is CSS under body[data-theme="<name>"] (fonts + colors on the clock .hm/.ampm/.date, .wx-temp, .lb/.le, .tcap, .wing-title, #amb .amb-clock, .bp). Copy the Thanksgiving block (#tgDecor, tgDaysLeft countdown in LALT) as the pattern. Fonts are self-hosted in www/fonts (see the "theme fonts" block in fonts.css).
- Same information on every theme: only colors, fonts and decorations change. Never use background-clip:text on the clock (it hides the rolling digits on the projector). Nothing decorative on the ceiling (it reads as real aircraft).

Rules
- Read bestly_memory first. Write what you learned back before you finish.
- Other sessions edit wall.html too. Patch it on the Pi with exact-anchor scripts that make a backup first. Never overwrite it from a local copy.
- Test on the real projector with adb screencap. Headless tests are useless for performance.
- Keep it at 30+ fps: no blur or backdrop-filter, and animate only transform and opacity.
- Decorations stay inside the strip, sign wall and sky surfaces. Hide any that would look wrong in ambient mode.
- Add a self-healing watchdog hook that reports to Scout.
- US units, 12-hour times, and a number never wraps away from its unit.
- Use the Apple design skill.
- Reply to me ADHD-style: answer first, short bullets, bold the key point, end with the one next step.

Theme to build: `;

/** Big iOS-style tile for the Now card. */
function QuickAction({ icon: Icon, label, onClick, active }: { icon: React.ElementType; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active ?? undefined}
      className={cn(
        "flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2 text-center text-[13px] font-medium leading-tight ring-1",
        "transition-[background-color,transform] duration-150 active:scale-[0.97] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 motion-reduce:transition-none motion-reduce:active:scale-100",
        active ? "bg-white text-black ring-white" : "bg-white/[0.07] text-white ring-white/10 hover:bg-white/[0.11]",
      )}>
      <Icon className="h-6 w-6 shrink-0" aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/** Section id from the URL hash ("#sleep" -> "sleep"). */
const hashId = () => { try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; } };

/** Copy text, falling back to a hidden textarea where the Clipboard API is blocked. */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
  }
}

/** Open/closed memory is a per-viewer convenience only, so storage failures are ignored.
 *  `opensFor` lists deep-link ids inside it: landing on one of those hashes opens it. */
function useRemembered(key: string, fallback: boolean, opensFor: string[] = []) {
  const [open, setOpen] = useState<boolean>(() => {
    if (opensFor.includes(hashId())) return true;
    try { const v = localStorage.getItem(key); return v == null ? fallback : v === "1"; } catch { return fallback; }
  });
  const opensKey = opensFor.join(",");
  useEffect(() => {
    if (!opensKey) return;
    const onHash = () => { if (opensKey.split(",").includes(hashId())) setOpen(true); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [opensKey]);
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* ignore */ }
    return !o;
  });
  return [open, toggle] as const;
}

/** Collapsible section for rarely used tools (progressive disclosure). */
function Disclosure({ id, title, summary, opensFor = [], children }: { id: string; title: string; summary?: string; opensFor?: string[]; children: React.ReactNode }) {
  const [open, toggle] = useRemembered(`wall-open-${id}`, false, [id, ...opensFor]);
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
      <button type="button" aria-expanded={open} aria-controls={`wall-${id}-panel`} onClick={toggle}
        className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-2 text-left ring-1 ring-white/10 transition-colors duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold text-white">{title}</span>
          {summary && <span className="block text-[13px] text-white/50">{summary}</span>}
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-white/50 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div id={`wall-${id}-panel`} className="space-y-6">{children}</div>}
    </section>
  );
}

/** A "More" row inside a group that reveals extra rows below it. */
function DisclosureRow({ id, label, summary, opensFor = [], children }: { id: string; label: string; summary?: string; opensFor?: string[]; children: React.ReactNode }) {
  const [open, toggle] = useRemembered(`wall-open-${id}`, false, [id, ...opensFor]);
  return (
    <>
      <button type="button" id={id} aria-expanded={open} aria-controls={`wall-${id}-rows`} onClick={toggle}
        className="flex min-h-[52px] w-full scroll-mt-20 items-center gap-3 border-b border-white/[0.07] px-4 py-2.5 text-left last:border-b-0 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] text-sky-400">{label}</span>
          {summary && !open && <span className="block text-[13px] text-white/50">{summary}</span>}
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-white/40 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div id={`wall-${id}-rows`}>{children}</div>}
    </>
  );
}

/* ───────── page ───────── */

export default function Wall() {
  const [r, setR] = useState<Remote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tool, setTool] = useState<"corners" | "mask" | "wing" | "air">("corners");
  const [sigs, setSigs] = useState<Sig[]>([]);
  const [signMsg, setSignMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [linkAll, setLinkAll] = useState(false);
  const [volDraft, setVolDraft] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [showAllSigs, setShowAllSigs] = useState(false);
  const [copiedAlign, setCopiedAlign] = useState(false);
  const [themeIdea, setThemeIdea] = useState("");
  const [copiedTheme, setCopiedTheme] = useState(false);
  const [sheepMins, setSheepMins] = useState<"15" | "30" | "60">("30");
  const [sheepMusic, setSheepMusic] = useState(true);
  const [, setSheepTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setSheepTick((n) => n + 1), 15000); return () => clearInterval(t); }, []);
  const [sel, setSel] = useState(0);
  const [fine, setFine] = useState(true);
  /** Layout undo history (DB keeps it for every writer) and the edit lock that stops stray swipes. */
  const [geoHist, setGeoHist] = useState<GeoStep[]>([]);
  const [geoWorking, setGeoWorking] = useState(false);
  const [editing, setEditing] = useState(false);
  const lastEdit = useRef(0);
  /** The one thing: Scout picks it every 10 min (wall_one_thing_tick); the admin only shows it. */
  const [oneInfo, setOneInfo] = useState<OneInfo | null>(null);
  const [oneBusy, setOneBusy] = useState(false);
  const [demo, setDemo] = useState<Record<DemoKey, string>>({ demoLeft: "", demoNames: "", demoRight: "" });
  const [pending, setPending] = useState(0);
  const [powerMsg, setPowerMsg] = useState<string | null>(null);
  /** What you last asked the projector to do, so the Now button flips right away instead of waiting a minute for the Pi. */
  const [powerHint, setPowerHint] = useState<{ on: boolean; at: number } | null>(null);
  const [, bump] = useState(0);
  const repaint = () => bump((n) => n + 1);

  const S = useRef<WallState | null>(null);
  const dragging = useRef(false);
  const typing = useRef(false);
  const padRef = useRef<HTMLDivElement>(null);
  const chan = useRef<RealtimeChannel | null>(null);
  const liveT = useRef<{ last: number; timer: number | null; next: Partial<WallState> | null }>({ last: 0, timer: null, next: null });
  const saveT = useRef<{ last: number; timer: number | null; next: Partial<WallState>; inflight: number }>({ last: 0, timer: null, next: {}, inflight: 0 });
  const geoBusy = useRef(false);

  const loadGeo = useCallback(async () => {
    const { data, error } = await rpc("wall_geometry_history_list");
    if (!error && Array.isArray(data)) setGeoHist(data as GeoStep[]);
  }, []);
  useEffect(() => { void loadGeo(); const t = setInterval(() => void loadGeo(), 5000); return () => clearInterval(t); }, [loadGeo]);

  const load = useCallback(async () => {
    const { data, error } = await rpc("wall_admin_get");
    if (error) { setErr(error.message); return; }
    setErr(null);
    const d = data as Remote;
    setR(d);
    if (!dragging.current && saveT.current.timer == null) { S.current = d.state; repaint(); }
    if (!typing.current) {
      setDemo(Object.fromEntries(DEMO_FIELDS.map((f) => [f.key, d.state[f.key] ?? f.fallback])) as Record<DemoKey, string>);
    }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [load]);

  const loadOne = useCallback(async (refresh = false) => {
    const { data, error } = await rpc("wall_one_thing_get", { p_refresh: refresh });
    if (!error && data) setOneInfo(data as OneInfo);
    return !error;
  }, []);
  useEffect(() => { void loadOne(); const t = setInterval(() => void loadOne(), 60000); return () => clearInterval(t); }, [loadOne]);
  const refreshOne = async () => {
    setOneBusy(true);
    const ok = await loadOne(true);
    setOneBusy(false);
    if (ok) toast.success("Scout checked again.", { id: "wall-act" }); else toast.error("Couldn't reach Scout. Try again in a moment.", { id: "wall-act" });
  };

  // Live channel to the Pi
  useEffect(() => {
    if (!r?.channel) return;
    const ch = supabase.channel(r.channel, { config: { broadcast: { self: false, ack: false } } });
    ch.subscribe();
    chan.current = ch;
    return () => { void supabase.removeChannel(ch); chan.current = null; };
  }, [r?.channel]);

  /** Broadcast to the wall at most every ~30 ms (always delivers the latest). */
  const sendLive = useCallback((p: Partial<WallState>) => {
    const L = liveT.current;
    L.next = { ...(L.next ?? {}), ...p };
    const fire = () => {
      L.timer = null; L.last = performance.now();
      const payload = L.next; L.next = null;
      if (payload) void chan.current?.send({ type: "broadcast", event: "state", payload });
    };
    const wait = 30 - (performance.now() - L.last);
    if (wait <= 0) fire(); else if (L.timer == null) L.timer = window.setTimeout(fire, wait);
  }, []);

  /** Save to the database at most every 400 ms (always saves the latest). */
  const sendSave = useCallback((p: Partial<WallState>, now = false) => {
    const T = saveT.current;
    T.next = { ...T.next, ...p };
    setPending(1);
    const fire = async () => {
      T.timer = null; T.last = performance.now();
      const payload = T.next; T.next = {};
      T.inflight++;
      const { error } = await rpc("wall_admin_set", { p_patch: payload });
      T.inflight--;
      if (T.timer == null) setPending(0);
      if (!error && GEO_KEYS.some((k) => k in payload)) void loadGeo();
      if (error) { setErr(`Couldn't save: ${error.message}`); toast.error(`Couldn't save: ${error.message}`, { id: "wall-act" }); }
    };
    if (T.timer != null) window.clearTimeout(T.timer);
    const wait = now ? 0 : Math.max(0, 400 - (performance.now() - T.last));
    T.timer = window.setTimeout(() => void fire(), wait);
  }, [loadGeo]);

  const change = useCallback((p: Partial<WallState>, opts: { now?: boolean } = {}) => {
    if (S.current) { S.current = { ...S.current, ...p }; repaint(); }
    sendLive(p);
    sendSave(p, opts.now ?? true);
  }, [sendLive, sendSave]);

  /** Undo or redo one layout step. The DB puts the geometry back and bumps the version (the Pi reloads);
   *  we also push it over the live channel so the wall moves right away. */
  const geoStep = useCallback(async (dir: "undo" | "redo") => {
    if (geoBusy.current || dragging.current) return;
    geoBusy.current = true; setGeoWorking(true);
    try {
      // Let the last drag or nudge finish saving first, so it is part of the history.
      for (let i = 0; i < 20 && (saveT.current.timer != null || saveT.current.inflight > 0); i++) await new Promise((r) => setTimeout(r, 100));
      const { data, error } = await rpc(dir === "undo" ? "wall_geometry_undo" : "wall_geometry_redo");
      const d = data as { ok: boolean; error?: string; reason?: string; geometry?: Partial<WallState> } | null;
      if (error || !d) { toast.error(`Couldn't ${dir}: ${error?.message ?? "no answer"}`, { id: "wall-geo" }); return; }
      if (!d.ok || !d.geometry) { toast(d.error ?? `Nothing to ${dir}.`, { id: "wall-geo" }); return; }
      const geo = d.geometry;
      if (S.current) {
        const base = { ...S.current } as Record<string, unknown>;
        GEO_KEYS.forEach((k) => { delete base[k]; });
        S.current = { ...(base as WallState), ...geo };
        repaint();
      }
      sendLive({ mask: null, ...geo });
      if (!geo.mask) setTool((t) => (t === "mask" ? "corners" : t));
      setSel(0);
      const other = dir === "undo" ? "redo" : "undo";
      toast.success(`${dir === "undo" ? "Undone" : "Redone"}: ${d.reason ?? "layout change"}`, {
        id: "wall-geo",
        action: { label: other === "redo" ? "Redo" : "Undo", onClick: () => void geoStepRef.current?.(other) },
      });
    } finally {
      geoBusy.current = false; setGeoWorking(false);
      void loadGeo();
    }
  }, [loadGeo, sendLive]);
  const geoStepRef = useRef<typeof geoStep | null>(null);
  geoStepRef.current = geoStep;
  const doUndo = useCallback(() => void geoStepRef.current?.("undo"), []);
  const doRedo = useCallback(() => void geoStepRef.current?.("redo"), []);
  const nextUndo = geoHist.find((h) => h.can_undo) ?? null;
  const nextRedo = geoHist.find((h) => h.can_redo) ?? null;

  // The layout locks itself again after 2 quiet minutes, so a stray swipe later can't move it.
  useEffect(() => {
    if (!editing) return;
    lastEdit.current = Date.now();
    const t = setInterval(() => { if (!dragging.current && Date.now() - lastEdit.current > 120000) setEditing(false); }, 10000);
    return () => clearInterval(t);
  }, [editing]);

  /* ───── mapping ───── */
  const EDGE = 100; // handle ids >= EDGE are side handles (side n runs from corner n to corner n+1)
  const s = S.current;
  const shapeKey = tool === "mask" ? "mask" : tool === "wing" ? "wing" : tool === "air" ? "air" : "corners";
  const quad: Pt[] | null = s ? (tool === "wing" ? (s.wing ?? DEFAULT_WING) : tool === "air" ? (s.air ?? DEFAULT_AIR) : s.corners) : null;
  const pts: Pt[] | null = s ? (tool === "mask" ? s.mask : quad) : null;

  // While Jared is adjusting (Edit layout, or the grid is on), tell the wall which block: it outlines it on the
  // projector while the alignment grid is up (state.layoutSel; wall.html r4w4Sel). Cleared when he's done.
  const wantSel = s && (editing || s.calGrid) ? tool : null;
  useEffect(() => {
    if (!S.current) return;
    if ((S.current.layoutSel ?? null) !== wantSel) change({ layoutSel: wantSel });
  }, [wantSel, change]);

  const move = (i: number, dx: number, dy: number, save: "throttle" | "now" = "throttle") => {
    const cur = S.current; if (!cur || !editing) return;
    lastEdit.current = Date.now();
    const key = shapeKey;
    const list = ((key === "wing" ? cur.wing ?? DEFAULT_WING : key === "air" ? cur.air ?? DEFAULT_AIR : cur[key]) ?? []).map((p) => [...p] as Pt);
    if (!list.length) return;
    const clamp = (v: number) => Math.min(1.5, Math.max(-0.5, v));
    if (i >= EDGE) {
      // side handle: move both corners of that side by the same amount, so the side stretches evenly
      const a = (i - EDGE) % list.length, b = (a + 1) % list.length;
      [a, b].forEach((j) => { list[j][0] = clamp(list[j][0] + dx); list[j][1] = clamp(list[j][1] + dy); });
    } else if (i === list.length) list.forEach((p) => { p[0] = clamp(p[0] + dx); p[1] = clamp(p[1] + dy); });
    else { list[i][0] = clamp(list[i][0] + dx); list[i][1] = clamp(list[i][1] + dy); }
    const patch: Partial<WallState> = { [key]: list };
    if (linkAll && i === list.length) {
      // projector got bumped: slide every area (strip, blocked area, sign wall, sky) by the same amount
      const shift = (pts?: Pt[] | null) => pts ? pts.map(([x, y]) => [clamp(x + dx), clamp(y + dy)] as Pt) : pts;
      (["corners", "mask", "wing", "air"] as const).forEach((k) => {
        if (k === key) return;
        const src = k === "wing" ? cur.wing ?? DEFAULT_WING : k === "air" ? cur.air ?? DEFAULT_AIR : cur[k];
        if (src) (patch as Record<string, unknown>)[k] = shift(src);
      });
    }
    S.current = { ...cur, ...patch };
    repaint();
    sendLive(patch);
    sendSave(patch, save === "now");
  };

  const startDrag = (i: number) => (e: React.PointerEvent<HTMLElement>) => {
    if (!editing) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dragging.current = true; setSel(i);
    let last = [e.clientX, e.clientY];
    const mv = (ev: PointerEvent) => {
      const rect = padRef.current?.getBoundingClientRect(); if (!rect) return;
      const k = fine ? 0.35 : 1;
      move(i, ((ev.clientX - last[0]) / rect.width) * k, ((ev.clientY - last[1]) / rect.height) * k);
      last = [ev.clientX, ev.clientY];
    };
    const up = () => {
      dragging.current = false;
      el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      const cur = S.current; if (cur) sendSave({ [shapeKey]: shapeKey === "wing" ? cur.wing ?? DEFAULT_WING : shapeKey === "air" ? cur.air ?? DEFAULT_AIR : cur[shapeKey] }, true);
    };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };

  const nudge = (dx: number, dy: number) => {
    const px = fine ? 1 : 10;
    move(sel, (dx * px) / 1920, (dy * px) / 1080, "now");
  };

  /** Resize the strip without changing its shape: scale all 4 corners around their center. */
  const scale = (grow: boolean) => {
    const c = tool === "wing" ? S.current?.wing ?? DEFAULT_WING : tool === "air" ? S.current?.air ?? DEFAULT_AIR : S.current?.corners; if (!c || !editing) return;
    lastEdit.current = Date.now();
    const step = fine ? 0.01 : 0.04;
    const f = grow ? 1 + step : 1 / (1 + step);
    const cx = c.reduce((a, p) => a + p[0], 0) / c.length;
    const cy = c.reduce((a, p) => a + p[1], 0) / c.length;
    const clamp = (v: number) => Math.min(1.5, Math.max(-0.5, v));
    change({ [tool === "wing" ? "wing" : tool === "air" ? "air" : "corners"]: c.map(([x, y]) => [clamp(cx + (x - cx) * f), clamp(cy + (y - cy) * f)] as Pt) });
  };

  /* ───── sign the wall ───── */
  const loadSigs = useCallback(async () => {
    const { data } = await rpc("wall_admin_signs");
    if (Array.isArray(data)) setSigs(data as Sig[]);
  }, []);
  useEffect(() => { void loadSigs(); const t = setInterval(() => void loadSigs(), 10000); return () => clearInterval(t); }, [loadSigs]);
  const signAction = async (action: "test" | "clear" | "hide" | "show" | "delete", id?: number) => {
    setSignMsg(null);
    const { data, error } = await rpc("wall_admin_sign_action", { p_action: action, p_id: id ?? null });
    if (error) { setSignMsg(`Didn't go through: ${error.message}`); toast.error(`Didn't go through: ${error.message}`, { id: "wall-act" }); return; }
    const d = data as { name?: string; ping?: string; emojis?: number } | null;
    const emo = (d?.emojis ?? 0) > 0;   // hiding / deleting a name also takes that guest's emoji off the wall (Show brings it back)
    if (d?.ping) {
      try { const ch = supabase.channel(d.ping); await ch.send({ type: "broadcast", event: "sign", payload: {} }); void supabase.removeChannel(ch); } catch { /* backup nudge only */ }
    }
    if (action === "test") { setSignMsg(`Sent a test signature from “${d?.name ?? "a guest"}”. Watch the wall.`); toast.success(`Test signature from “${d?.name ?? "a guest"}” sent. Watch the wall.`, { id: "wall-act" }); }
    if (action === "hide" || action === "show") toast.success(action === "hide" ? (emo ? "Hidden from the wall, emoji too." : "Hidden from the wall.") : (emo ? "Back on the wall, with their emoji." : "Back on the wall."), { id: "wall-act" });
    if (action === "clear") { const m = emo ? "Wall cleared. Names are hidden and their emojis are off the wall." : "Wall cleared. Names are hidden, not deleted."; setSignMsg(m); toast.success(m, { id: "wall-act" }); }
    if (action === "delete") { const m = emo ? "Signature and emoji deleted for good." : "Signature deleted for good."; setSignMsg(m); toast.success(m, { id: "wall-act" }); setSigs((l) => l.filter((x) => x.id !== id)); }
    void loadSigs();
  };

  const addMask = () => {
    const c = S.current?.corners ?? DEFAULT_CORNERS;
    const [tr, br] = [c[1], c[2]];
    const mask: Pt[] = [[br[0] - 0.12, br[1] + 0.02], [tr[0] + 0.02, tr[1] + (br[1] - tr[1]) * 0.35], [br[0] + 0.02, br[1] + 0.02]];
    setTool("mask"); setSel(0);
    change({ mask, mapping: true });
  };

  const restartWall = async () => {
    setPowerMsg("Restarting the wall… back in about 15 seconds.");
    const { error } = await rpc("wall_admin_command", { p_cmd: "relaunch" });
    setPowerMsg(error ? `Didn't go through: ${error.message}` : "Restart sent. The wall wakes, reopens and comes back in about 15\u00a0seconds.");
    if (error) toast.error(`Didn't go through: ${error.message}`, { id: "wall-act" }); else toast.success("Restarting. Back in about 15\u00a0seconds.", { id: "wall-act" });
    void load();
  };

  const [apMsg, setApMsg] = useState<string | null>(null);
  const restartAirplay = async () => {
    setApMsg("Restarting AirPlay…");
    const { error } = await rpc("wall_admin_command", { p_cmd: "airplay_restart" });
    setApMsg(error ? `Didn't go through: ${error.message}` : "Restarted. Bestly Wall shows up in AirPlay again in about 10\u00a0seconds.");
    if (error) toast.error(`Didn't go through: ${error.message}`, { id: "wall-act" }); else toast.success("AirPlay restarted.", { id: "wall-act" });
    void load();
  };

  const nudgeFocus = async (dir: "focus_left" | "focus_right") => {
    setPowerMsg("Moving the lens one step. The focus screen shows for a few seconds, then the wall comes back.");
    const { error } = await rpc("wall_admin_command", { p_cmd: dir });
    setPowerMsg(error ? `Didn't go through: ${error.message}` : "Moved one step. Look at the sign wall: tap again the same way if it got sharper, the other way if it got softer.");
    if (error) toast.error(`Didn't go through: ${error.message}`, { id: "wall-act" });
    void load();
  };

  const focus = async () => {
    setPowerMsg("Focusing… the picture blurs for about 15 seconds.");
    const { error } = await rpc("wall_admin_command", { p_cmd: "focus" });
    setPowerMsg(error ? `Didn't go through: ${error.message}` : "Focus sent. Tap again if it still looks soft.");
    if (error) toast.error(`Didn't go through: ${error.message}`, { id: "wall-act" }); else toast.success("Focusing. Tap again if it still looks soft.", { id: "wall-act" });
    void load();
  };

  const power = async (wantOn: boolean) => {
    setPowerMsg(wantOn ? "Turning on…" : "Turning off…");
    toast.loading(wantOn ? "Turning the projector on…" : "Turning the projector off…", { id: "wall-act" });
    const { error } = await rpc("wall_admin_power", { p_on: wantOn });
    const msg = error ? `Didn't go through: ${error.message}` : wantOn ? "On. Stays on until midnight." : "Off until 7\u00a0AM, or until you tap Turn on.";
    setPowerMsg(msg);
    if (error) toast.error(msg, { id: "wall-act" }); else { setPowerHint({ on: wantOn, at: Date.now() }); toast.success(msg, { id: "wall-act" }); }
    void load();
  };

  /* ───── status ───── */
  const st = r?.status ?? null;
  const pullAge = secsAgo(r?.pulled_at ?? null);
  const piOnline = pullAge != null && pullAge < 45;
  const statusAge = secsAgo(r?.status_at ?? null);

  const hero = useMemo(() => {
    if (!r) return null;
    if (s?.away) return { tone: "idle", icon: Plane, title: "Away mode", sub: "The Pi leaves the projector alone until you turn this off." };
    if (!piOnline) return { tone: "bad", icon: WifiOff, title: "The Pi isn't checking in", sub: `Last seen ${agoText(pullAge)}. Changes will apply when it's back.` };
    const txt = st?.status ?? "";
    if (txt.startsWith("unreachable")) return { tone: "bad", icon: WifiOff, title: "Projector is offline", sub: "Check it's plugged in and on Wi-Fi." };
    if (txt === "asleep") return { tone: "idle", icon: MoonStar, title: "Projector is asleep", sub: "It wakes at 7\u00a0AM. Tap Turn on to wake it now." };
    if (txt.startsWith("in use")) return { tone: "warn", icon: Projector, title: "Projector is showing another app", sub: `${txt.replace("in use: ", "")} is open. The wall comes back when you go to the home screen.` };
    // The Pi reports once a minute. A report older than 2.5 minutes can't vouch for what's on the wall now.
    if (statusAge != null && statusAge > 150) {
      return { tone: "warn", icon: AlertTriangle, title: "Can't confirm the wall right now", sub: `The Pi's last wall check was ${agoText(statusAge)}. It may be busy or offline.` };
    }
    if (txt === "ok") {
      // How old the page's heartbeat is *now*, not when the Pi looked.
      const beatAge = (st?.heartbeat_age_s ?? 999) + (statusAge ?? 0);
      const pageOk = beatAge < 120;   // beats every 30 s + up to a minute between Pi reports
      const dark = st?.last_dark && Date.now() / 1000 - st.last_dark.at < 30 * 60 ? st.last_dark : null;
      const darkWhen = dark ? new Date(dark.at * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
      if (!pageOk) return { tone: "bad", icon: AlertTriangle, title: "The wall isn't showing", sub: "The page stopped checking in. The watchdog restarts it within a minute." };
      if (st?.page_mode === "off") return { tone: "idle", icon: MoonStar, title: "The wall is dark (Off)", sub: "The projector is on but the wall is set to Off. Pick Board or Auto to bring it back." };
      if ((st?.dark_30m ?? 0) >= 2) return { tone: "warn", icon: AlertTriangle, title: "The wall keeps going dark", sub: `${st?.dark_30m} times in 30\u00a0minutes, latest at ${darkWhen} (${dark?.why}). It's back now; Scout was alerted.` };
      return { tone: "ok", icon: CheckCircle2, title: "On the wall",
        sub: dark ? `Went dark at ${darkWhen} (${dark.why}), back on its own.` : `Showing now${st?.cpu_c != null ? ` · projector ${toF(st.cpu_c)}°F` : ""}` };
    }
    return { tone: "idle", icon: Loader2, title: "Checking…", sub: "" };
  }, [r, s?.away, piOnline, pullAge, st, statusAge]);

  const toneRing = { ok: "ring-emerald-400/30 bg-emerald-400/[0.06]", warn: "ring-amber-400/30 bg-amber-400/[0.06]", bad: "ring-red-400/35 bg-red-400/[0.07]", idle: "ring-white/10 bg-white/[0.04]" } as const;
  const toneIcon = { ok: "text-emerald-400", warn: "text-amber-400", bad: "text-red-400", idle: "text-white/60" } as const;

  const sync = !r ? null : !piOnline
    ? { dot: "bg-red-400", text: "Pi offline" }
    : pending > 0
      ? { dot: "bg-amber-400 animate-pulse", text: "Saving…" }
      : { dot: "bg-emerald-400", text: "Synced" };

  /* ───── deep links: /admin/wall#sleep, #show, #live (Live Activities), #theme ───── */
  // Sign-in and the first load render a placeholder, so wait until the real sections exist, then scroll.
  // Two frames let any disclosure that holds the target open first (useRemembered opensFor).
  const ready = !!r && !!s;
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const go = () => {
      const id = hashId();
      if (!id) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          const el = document.getElementById(id);
          if (!el) return;
          const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        });
      });
    };
    go();
    window.addEventListener("hashchange", go);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("hashchange", go); };
  }, [ready]);

  if (!r || !s) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Wall" description="The projector strip above your desk." />
        {err ? (
          <p className="rounded-2xl bg-red-500/10 p-4 text-[15px] text-red-200 ring-1 ring-red-500/30">{err}</p>
        ) : (
          <div className="space-y-4" aria-busy="true">
            {[88, 120, 260].map((h) => <div key={h} className="animate-pulse rounded-2xl bg-white/[0.05]" style={{ height: h }} />)}
          </div>
        )}
      </div>
    );
  }

  const modeAbout = MODES.find((m) => m.id === s.mode)?.about;
  const handles: Pt[] = pts ? [...pts, pts.reduce<Pt>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0])] : [];

  const now = Date.now();
  const tour = s.tour && s.tour.cmd !== "stop" && now - s.tour.at < (s.tour.cmd === "skit" ? 3 : 45) * 60000 ? s.tour : null;
  const showOn = !!tour && tour.cmd !== "skit";
  const skitOn = tour?.cmd === "skit";
  const sheepEnd = s.sleepShow ? s.sleepShow.at + s.sleepShow.mins * 60000 : 0;
  const sheepOn = !!s.sleepShow && now < sheepEnd;
  const ap = st?.airplay ?? null;
  const asleep = powerHint && now - powerHint.at < 90000
    ? !powerHint.on
    : st?.status === "asleep" || (st?.status ?? "").startsWith("unreachable");
  const modeLabel = MODES.find((m) => m.id === s.mode)?.label ?? s.mode;
  const playing = sheepOn
    ? <>Counting sheep until <NW>{time12(sheepEnd)}</NW></>
    : tour
      ? <>{TOUR_NAME[tour.cmd]}, started <NW>{time12(tour.at)}</NW></>
      : ap?.casting && s.airplay !== false
        ? <>AirPlay {ap.kind === "audio" ? "audio" : "video"}</>
        : null;
  const sheepLen = sheepMins === "60" ? "1\u00a0hour" : `${sheepMins}\u00a0minutes`;

  /** Make a change and confirm it with a toast (one toast at a time, the newest wins). */
  const act = (p: Partial<WallState>, msg: string) => { change(p); toast.success(msg, { id: "wall-act" }); };
  const playShow = (cmd: "play" | "party" | "skit" | "hshow" | "hparty") =>
    act({ tour: { cmd, at: Date.now() } }, `${TOUR_NAME[cmd]} starting on the wall.`);
  const stopShow = () => act({ tour: { cmd: "stop", at: Date.now() } }, "Stopping. The wall goes back to normal.");
  const startSheep = () => act({ sleepShow: { at: Date.now(), mins: Number(sheepMins), music: sheepMusic } }, `Counting sheep for ${sheepLen}. Good night.`);
  const stopSheep = () => act({ sleepShow: null }, "Sleep mode stopped.");
  /** The one place the theme is written: Normal -> null, anything else -> its value. */
  const themeNow = THEMES.find((t) => t.id === (s.theme ?? "normal")) ?? THEMES[0];
  const setTheme = (id: (typeof THEMES)[number]["id"]) => {
    const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
    act({ theme: id === "normal" ? null : id }, `Theme: ${t.label}.`);
  };
  const copyThemePrompt = async () => {
    const idea = themeIdea.trim();
    if (!idea) return;
    await copyText(NEW_THEME_PROMPT + idea);
    setCopiedTheme(true); window.setTimeout(() => setCopiedTheme(false), 2500);
    toast.success("Copied. Paste it into a Claude chat.", { id: "wall-act" });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-10 xl:max-w-[1640px]">
      <PageHeader
        title="Wall"
        description="The projector strip above your desk. Changes show up as you make them."
        actions={sync && (
          <span className="hidden items-center gap-2 sm:inline-flex rounded-full bg-white/[0.06] px-3 py-1.5 text-[13px] text-white/80 ring-1 ring-white/10" aria-live="polite">
            <span className={cn("h-2 w-2 rounded-full", sync.dot)} /> {sync.text}
          </span>
        )}
      />

      {err && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl bg-red-500/10 p-4 text-[15px] text-red-200 ring-1 ring-red-500/30">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> <span className="flex-1">{err}</span>
          <button type="button" className="min-h-[44px] text-[15px] font-medium underline underline-offset-2" onClick={() => { setErr(null); void load(); }}>Try again</button>
        </div>
      )}

      {/* Desktop: grouped cards in columns. 1280 px: two columns (Now + Sky and guests | Shows and alerts + Sound);
          1536 px: three (Now | Shows and alerts | Sound, then Sky and guests). Phone: one column in this order. */}
      <div className="grid items-start gap-6 xl:grid-cols-2 xl:gap-8 2xl:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1 2xl:row-span-2">
      <h2 className="hidden px-1 text-[20px] font-semibold tracking-tight text-white xl:block">Now</h2>
      {/* Now: status, what's on the wall, and the four things you reach for most */}
      {hero && (
        <section aria-label="Now" className={cn("rounded-2xl p-4 ring-1", toneRing[hero.tone as keyof typeof toneRing])}>
          <div className="flex items-start gap-3">
            <hero.icon className={cn("mt-0.5 h-6 w-6 shrink-0", toneIcon[hero.tone as keyof typeof toneIcon], hero.icon === Loader2 && "animate-spin")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-semibold leading-snug text-white">{hero.title}</div>
              {hero.sub && <div className="mt-0.5 text-[15px] leading-snug text-white/65">{hero.sub}</div>}
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
            <dt className="text-white/50">Mode</dt><dd className="text-white">{modeLabel}</dd>
            {s.theme && <><dt className="text-white/50">Theme</dt><dd className="text-white">{themeNow.label}</dd></>}
            <dt className="text-white/50">Playing</dt><dd className="text-white">{playing ?? <span className="text-white/60">Nothing extra</span>}</dd>
            {s.one && <><dt className="text-white/50">One thing</dt><dd className="min-w-0 truncate text-white">{s.one}</dd></>}
          </dl>
          <div className="mt-2 text-[13px] text-white/45" aria-live="polite">
            {sync && <span className="mr-1.5 inline-flex items-center gap-1.5 text-white/70 sm:hidden"><span className={cn("h-2 w-2 rounded-full", sync.dot)} aria-hidden />{sync.text} ·</span>}
            Last check {agoText(statusAge)}
            {st?.override && st.override.until * 1000 > Date.now() && <> · held {st.override.on ? "on" : "off"} until <NW>{time12(st.override.until * 1000)}</NW></>}
          </div>
          {!!r.issues?.length && (
            <ul className="mt-3 space-y-2 border-t border-white/10 pt-3">
              {r.issues.map((i) => (
                <li key={i.key} className="flex items-start gap-2 text-[15px]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
                  <span><span className="text-white">{i.title}</span>{i.needs && <span className="block text-white/60">{i.needs}</span>}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid grid-cols-4 gap-2" role="group" aria-label="Quick actions">
            <QuickAction icon={Power} label={asleep ? "Turn on" : "Turn off"} onClick={() => void power(asleep)} />
            <QuickAction icon={showOn ? Square : Presentation} label={showOn ? "Stop show" : "Play show"} active={showOn}
              onClick={() => (showOn ? stopShow() : playShow("play"))} />
            <QuickAction icon={skitOn ? Square : Clapperboard} label={skitOn ? "Stop skit" : "Skit"} active={skitOn}
              onClick={() => (skitOn ? stopShow() : playShow("skit"))} />
            <QuickAction icon={Moon} label={sheepOn ? "Stop sheep" : "Sleep mode"} active={sheepOn}
              onClick={() => (sheepOn ? stopSheep() : startSheep())} />
          </div>
          <MotivateButton seq={s.motivate?.seq ?? 0} onFire={(m) => act({ motivate: m }, "Motivate me: a pep talk is on its way to the wall.")} />
          {s.away && (
            <button type="button" className={cn(btn, "mt-2 w-full")} onClick={() => act({ away: false }, "Away mode off. The Pi looks after the projector again.")}>
              <Plane className="h-4 w-4" aria-hidden /> Turn off Away mode
            </button>
          )}
        </section>
      )}

      <DndCard dnd={s.dnd} onChange={(d, msg) => act({ dnd: d }, msg)} />

      <VoiceCard voice={s.voice} onChange={(v, msg) => act({ voice: v }, msg)} />

      {/* On the wall: mode + the big message */}
      <Group title="On the wall" footer="Scout picks the one thing from today's list and updates it every 10 minutes.">
        <Row label="Off when I leave home" detail={"Uses your iPhone's location in Home Assistant. Turns off 10\u00a0min after you leave, back on when you get home (7\u00a0AM to bedtime)."} htmlFor="wall-presence">
          <Switch className={swHit} id="wall-presence" checked={s.presence !== false} onCheckedChange={(v) => act({ presence: v }, v ? "The wall turns off when you leave home." : "The wall stays on its schedule when you leave.")} />
        </Row>
        <div className="p-2">
          <Segmented compact label="Mode" value={s.mode} onChange={(m) => act({ mode: m }, `Mode: ${MODES.find((x) => x.id === m)?.label ?? m}.`)}
            options={MODES.map((m) => ({ id: m.id, label: m.label }))} />
          {modeAbout && <p className="px-2 pb-1 pt-2 text-[13px] leading-snug text-white/55">{modeAbout}</p>}
        </div>
        {/* The one thing: read-only. Scout fills it (wall_one_thing_tick every 10 min); no typing here. */}
        <div className="flex items-start gap-3 border-y border-white/[0.07] px-4 py-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" aria-hidden />
          <div className="min-w-0 flex-1" aria-live="polite">
            <div className="text-[13px] font-medium uppercase tracking-[0.06em] text-white/50">The one thing · picked by Scout</div>
            <div className="mt-0.5 text-[16px] leading-snug text-white [text-wrap:pretty]">
              {(oneInfo?.text ?? s.one) || <span className="text-white/60">Nothing urgent. The wall says “Make something great.”</span>}
            </div>
            {(oneInfo?.why || oneInfo?.checked_at) && (
              <div className="mt-0.5 text-[13px] leading-snug text-white/50">
                {oneInfo?.why ? `${oneInfo.why} ` : ""}
                {oneInfo?.checked_at && <>Checked <NW>{time12(new Date(oneInfo.checked_at).getTime())}</NW>{oneInfo.source ? ` · from ${oneInfo.source}` : ""}.</>}
              </div>
            )}
            {oneInfo?.error && <div className="mt-0.5 text-[13px] text-amber-300">Scout couldn't update it last time. It retries every 10{"\u00a0"}minutes.</div>}
          </div>
          <button type="button" onClick={() => void refreshOne()} disabled={oneBusy} aria-label="Ask Scout to pick again now"
            className="-mr-2 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-sky-400 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40">
            <RotateCw className={cn("h-5 w-5", oneBusy && "animate-spin motion-reduce:animate-none")} aria-hidden />
          </button>
        </div>
        <Row label="Show today's date on the left" detail="The left side of the strip shows today's date instead of rotating through messages." htmlFor="wall-left-date">
          <Switch className={swHit} id="wall-left-date" checked={!!s.leftDate} onCheckedChange={(v) => act({ leftDate: v }, v ? "Today's date on the left." : "The left side rotates again.")} />
        </Row>
      </Group>

      {/* Strip widgets (W2 round 3): the left side takes turns with the clock; switch any widget off here. */}
      <Group id="strip-widgets" title="Strip widgets" footer="The left side of the strip takes turns with the clock; Turo calendar and Claude usage take turns on the right. A widget with nothing to show skips its turn.">
        {STRIP_WIDGETS.map((w) => {
          const hid = `wall-w-${w.id.replace("$", "usd")}`;
          return (
            <Row key={w.id} label={w.label} detail={w.detail} htmlFor={hid}>
              <Switch className={swHit} id={hid} checked={s.widgets?.[w.id] !== false}
                onCheckedChange={(v) => act({ widgets: { ...(s.widgets ?? {}), [w.id]: v } }, `${w.label} ${v ? "on" : "off"}.`)} />
            </Row>
          );
        })}
        <div className="px-4 py-3">
          <button type="button" className={cn(btn, "w-full")} onClick={() => act({ bookingDemo: Date.now() }, "Showing a sample Turo booking on the strip for 20 seconds.")}>
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden /> Show a sample Turo booking
          </button>
        </div>
      </Group>

      {/* Demo text: only while Demo mode is showing */}
      {s.mode === "demo" && (
        <Group title="Demo text" footer="Left and right can be two lines. Changes show on the wall as you type.">
          {DEMO_FIELDS.map((f) => (
            <div key={f.key} className="flex items-start gap-3 border-b border-white/[0.07] px-4 py-2 last:border-b-0">
              <label htmlFor={`wall-${f.key}`} className="min-h-[44px] w-16 shrink-0 pt-3 text-[15px] text-white/60">{f.label}</label>
              <textarea
                id={`wall-${f.key}`} rows={f.lines} maxLength={60} value={demo[f.key]} placeholder={f.placeholder.replace("\n", " / ")}
                autoComplete="off" spellCheck={false}
                onFocus={() => (typing.current = true)}
                onBlur={() => { typing.current = false; }}
                onChange={(e) => {
                  const v = f.lines === 1 ? e.target.value.replace(/\n/g, " ") : e.target.value.split("\n").slice(0, 2).join("\n");
                  setDemo((d) => ({ ...d, [f.key]: v }));
                  change({ [f.key]: v } as Partial<WallState>, { now: false });
                }}
                className="min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[17px] leading-snug text-white placeholder:text-white/35 focus:outline-none"
              />
            </div>
          ))}
        </Group>
      )}

      </div>
      <div className="flex min-w-0 flex-col gap-6 xl:col-start-2 xl:row-start-1 2xl:row-span-2">
      <h2 className="hidden px-1 text-[20px] font-semibold tracking-tight text-white xl:block">Shows and alerts</h2>
      {/* Show for friends: a ~2 minute tour, then a party loop until you stop it (45 min max). */}
      <Group id="show" title="Show for friends"
        footer={<>The show is a 2-minute tour, then a party until you stop it (45{"\u00a0"}minutes max). The skit is a 2-minute cartoon with speech bubbles. Music and voices play when wall sound is on and Do Not Disturb isn't; otherwise it's lights only.</>}>
        {tour ? (
          /* Playing: Stop is the one filled button, so it's the obvious tap (the Live Activity lands here). */
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-3">
              {skitOn ? <Clapperboard className="h-5 w-5 shrink-0 text-red-300" aria-hidden /> : <PartyPopper className="h-5 w-5 shrink-0 text-red-300" aria-hidden />}
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-semibold text-white">{TOUR_NAME[tour.cmd]} is playing</div>
                <div className="text-[15px] text-white/60">Started <NW>{time12(tour.at)}</NW></div>
              </div>
            </div>
            <button type="button" className={cn(btnPrimary, "w-full bg-red-500 text-white hover:bg-red-500/90 active:bg-red-500/80")} onClick={stopShow}>
              <Square className="h-5 w-5" aria-hidden /> {skitOn ? "Stop the skit" : "Stop the show"}
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" className={cn(btn, "px-2")} onClick={() => playShow("play")}>
                <Presentation className="h-4 w-4 shrink-0" aria-hidden /> Show
              </button>
              <button type="button" className={cn(btn, "px-2")} onClick={() => playShow("party")}>
                <PartyPopper className="h-4 w-4 shrink-0" aria-hidden /> Party
              </button>
              <button type="button" className={cn(btn, "px-2")} onClick={() => playShow("skit")}>
                <Clapperboard className="h-4 w-4 shrink-0" aria-hidden /> Skit
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 px-4 py-3">
            <button type="button" className={cn(btnPrimary, "w-full")} onClick={() => playShow("play")}>
              <Presentation className="h-5 w-5" aria-hidden /> Play the show
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" className={cn(btn, "px-2")} onClick={() => playShow("party")}>
                <PartyPopper className="h-4 w-4 shrink-0" aria-hidden /> Party
              </button>
              <button type="button" className={cn(btn, "px-2")} onClick={() => playShow("skit")}>
                <Clapperboard className="h-4 w-4 shrink-0" aria-hidden /> Skit
              </button>
              <button type="button" className={cn(btn, "px-2")} onClick={stopShow}>
                <Square className="h-4 w-4 shrink-0" aria-hidden /> Stop
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 border-t border-white/[0.07] px-4 py-3">
          <button type="button" className={cn(btn, "px-2")} onClick={() => playShow("hshow")}>
            <Ghost className="h-4 w-4 shrink-0" aria-hidden /> Halloween show
          </button>
          <button type="button" className={cn(btn, "px-2")} onClick={() => playShow("hparty")}>
            <Skull className="h-4 w-4 shrink-0" aria-hidden /> Halloween party
          </button>
        </div>
      </Group>

      {/* Sleep mode: counting sheep */}
      <Group id="sleep" title="Sleep mode" footer={`Sheep hop a fence while a soft lullaby plays. It slows down as you drift off, says good night, and turns the projector off until 7\u00a0AM.`}>
        {sheepOn ? (
          /* Counting: Stop is the one filled button, so it's the obvious tap (the Live Activity lands here). */
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <Moon className="h-5 w-5 shrink-0 text-indigo-300" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-semibold text-white">Counting sheep</div>
                <div className="text-[15px] text-white/60">Ends at <NW>{time12(sheepEnd)}</NW></div>
              </div>
            </div>
            <button type="button" className={cn(btnPrimary, "w-full")} onClick={stopSheep}>
              <Square className="h-5 w-5" aria-hidden /> Stop counting sheep
            </button>
          </div>
        ) : (
          <div className="space-y-3 px-4 py-3">
            <Segmented label="Length" value={sheepMins} onChange={(v) => setSheepMins(v as "15" | "30" | "60")}
              options={[{ id: "15", label: "15\u00a0min" }, { id: "30", label: "30\u00a0min" }, { id: "60", label: "1\u00a0hour" }]} />
            <div className="flex min-h-[44px] items-center justify-between">
              <label htmlFor="wall-sheep-music" className="text-[16px] text-white">Lullaby music</label>
              <Switch className={swHit} id="wall-sheep-music" checked={sheepMusic} onCheckedChange={setSheepMusic} />
            </div>
            <button type="button" className={cn(btnPrimary, "w-full bg-indigo-500 text-white hover:bg-indigo-500/90 active:bg-indigo-500/80")} onClick={startSheep}>
              <Moon className="h-5 w-5" aria-hidden /> Start counting sheep
            </button>
          </div>
        )}
      </Group>

      {/* Wake-up alarm: the Pi wakes the projector, unmutes, raises the volume; the wall plays a sunrise with bells. */}
      {(() => {
        const a = s.alarm ?? null;
        const on = !!a?.on;
        const time = a?.time ?? "07:00";
        const days = a?.days ?? "once";
        const setA = (p: Partial<NonNullable<WallState["alarm"]>>) => change({ alarm: { on, time, days, vol: a?.vol ?? 60, ...(a ?? {}), ...p, set_at: Date.now() } as WallState["alarm"] });
        const [hh, mm] = time.split(":").map(Number);
        const pretty = new Date(2000, 0, 1, hh || 0, mm || 0).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        const daysTxt = days === "once" ? "once" : days === "weekdays" ? "weekdays" : days === "weekends" ? "weekends" : "every day";
        return (
          <Group title="Alarm" footer="The wall wakes a minute early, turns the sound on, and a sunrise with bells fills the strip. The bells get louder until you tap Stop. Your phone gets a notification if the wall can't ring.">
            <Row htmlFor="wall-alarm" label="Wake-up alarm" detail={on ? <><NW>{pretty}</NW>, {daysTxt}</> : "Off"}>
              <Switch className={swHit} id="wall-alarm" checked={on} onCheckedChange={(v) => { setA({ on: v }); toast.success(v ? `Alarm set for ${pretty}, ${daysTxt}.` : "Alarm off.", { id: "wall-act" }); }} />
            </Row>
            <div className="space-y-3 px-4 py-3">
              {on && <>
              <label className="flex items-center justify-between gap-3 text-[16px] text-white">
                <span>Time</span>
                <input type="time" value={time} onChange={(e) => e.target.value && setA({ time: e.target.value, on: true })}
                  className="min-h-[44px] rounded-lg bg-white/[0.07] px-3 text-[16px] text-white [color-scheme:dark]" />
              </label>
              <Segmented compact label="Repeat" value={days} onChange={(v) => setA({ days: v })}
                options={[{ id: "once", label: "Once" }, { id: "weekdays", label: "Weekdays" }, { id: "weekends", label: "Weekends" }, { id: "daily", label: "Daily" }]} />
              </>}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={cn(btn, "px-2")} onClick={() => act({ alarm: { ...(a ?? { on: false, time }), stop: Date.now() } as WallState["alarm"] }, "Alarm stopped.")}>
                  <Square className="h-4 w-4 shrink-0" aria-hidden /> Stop alarm
                </button>
                <button type="button" className={cn(btn, "px-2")} onClick={() => act({ alarm: { ...(a ?? { on: false, time }), test: Date.now() } as WallState["alarm"] }, "Playing a 20-second preview on the wall.")}>
                  <Sun className="h-4 w-4 shrink-0" aria-hidden /> Preview
                </button>
              </div>
            </div>
          </Group>
        );
      })()}

      {/* Turo handoff: the wall's inline trip card (server.py trip_loop). Dismiss (state.tripDismiss {id, at}) hides it on
          the wall and ends the iPhone Live Activity. It also ends on its own (car left the spot / trip started / 2 h late). */}
      {(() => {
        const t = st?.trip;
        if (!t?.active || !t.id) return null;
        const id = t.id;
        const gone = s.tripDismiss?.id === id;
        const old = t.fresh_age_s != null && t.fresh_age_s > 330;
        return (
          <Group title="Turo handoff" footer={t.kind === "deliver"
            ? "You drive it there at least an hour before pickup. It ends on its own when the trip starts."
            : "Next buses and trains refresh every 2\u00a0minutes. It ends on its own when the car leaves the spot, or 2\u00a0hours after you were due there."}>
            <Row label={t.title ?? "Turo handoff"} detail={<>{t.line}{old ? " · may be out of date" : ""}{t.test ? " · test" : ""}</>}>
              <button type="button" className={cn(btn, "px-3 text-[14px]")} disabled={gone}
                onClick={() => act({ tripDismiss: { id, at: Date.now() } }, "Dismissed on the wall and your phone.")}>
                <Car className="h-4 w-4 shrink-0" aria-hidden /> {gone ? "Dismissed" : "Dismiss"}
              </button>
            </Row>
          </Group>
        );
      })()}

      {/* Heads-up: a card grows on the wall 15 minutes before ("soon", quiet), then "now" with a chime + a phone push. */}
      {(() => {
        const list = (s.heads ?? []).filter((h) => h && h.at > Date.now() - 20 * 60000).sort((x, y) => x.at - y.at);
        if (list.length === 0) return null; // heads-ups are added from elsewhere; nothing to show until one exists
        return (
          <Group title="Heads-up" footer={`A card appears on the wall 15\u00a0minutes before, then at the time it chimes and your phone gets a notification.`}>
            {list.map((h) => (
              <Row key={h.id} label={h.title} detail={<><NW>{new Date(h.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</NW>{h.sub ? ` · ${h.sub}` : ""}</>}>
                <button type="button" className={cn(btn, "px-3 text-[14px]")}
                  onClick={() => act({ heads: (s.heads ?? []).filter((x) => x.id !== h.id) }, `Removed “${h.title}”.`)}>Remove</button>
              </Row>
            ))}
            <div className="px-4 py-3">
              <button type="button" className={cn(btn, "w-full")} onClick={() => act({ headsStop: Date.now() }, "Dismissed on the wall and your phone.")}>
                <Square className="h-4 w-4" aria-hidden /> Dismiss what's showing
              </button>
            </div>
          </Group>
        );
      })()}

      {/* Packages: "Got it" hides one from the wall (W2 data: wall_admin_packages / wall_package_done). */}
      <PackagesCard />

      {/* Live Activities: the wall server drives these on Jared's iPhone. liveActs is {kind: boolean}; missing = on. */}
      {(() => {
        const acts = s.liveActs ?? {};
        const setAct = (id: LiveKind, v: boolean) => {
          const full = Object.fromEntries(LIVE_ACTS.map((x) => [x.id, x.id === id ? v : acts[x.id] !== false])) as Record<LiveKind, boolean>;
          const label = LIVE_ACTS.find((x) => x.id === id)?.label ?? id;
          act({ liveActs: full }, `${label} ${v ? "on" : "off"} for your iPhone.`);
        };
        const onCount = LIVE_ACTS.filter((x) => acts[x.id] !== false).length;
        return (
          <Group id="live" title="Live Activities" footer={`Live cards on your iPhone's Lock Screen and Dynamic Island, sent by the wall. ${onCount} of ${LIVE_ACTS.length} on.`}>
            {LIVE_ACTS.map((x) => (
              <Row key={x.id} htmlFor={`wall-la-${x.id}`} detail={x.detail}
                label={<span className="inline-flex items-center gap-2"><x.icon className={cn("h-4 w-4 shrink-0", x.id === "incident" ? "text-red-400" : "text-white/60")} aria-hidden />{x.label}</span>}>
                <Switch className={swHit} id={`wall-la-${x.id}`} checked={acts[x.id] !== false} onCheckedChange={(v) => setAct(x.id, v)} />
              </Row>
            ))}
          </Group>
        );
      })()}

      {/* Theme: the only control for state key `theme` (null = Normal). New themes start from the copied prompt. */}
      <Group id="theme" title="Theme">
        <div className="border-b border-white/[0.07] p-2">
          {/* compact + icons from sm up, so all three labels fit one row on a 390 pt phone */}
          <Segmented label="Theme" value={themeNow.id} onChange={setTheme} compact
            options={THEMES.map((t) => {
              const Icon = THEME_ICON[t.id];
              return { id: t.id, label: Icon ? <><Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden />{t.label}</> : t.label };
            })} />
          <p className="px-2 pb-1 pt-2 text-[13px] leading-snug text-white/55">{themeNow.detail}</p>
        </div>
        <DisclosureRow id="new-theme" label="Add a new theme" summary="Copy a prompt that has Claude build it">
          <div className="space-y-3 px-4 py-3">
            <label htmlFor="wall-theme-idea" className="block text-[16px] text-white">Theme name or idea</label>
            <textarea
              id="wall-theme-idea" rows={3} maxLength={600} value={themeIdea} autoComplete="off"
              placeholder="e.g. Christmas: snow falling, twinkly lights, a sleigh crossing the ceiling"
              onChange={(e) => setThemeIdea(e.target.value)}
              className="min-h-[88px] w-full resize-none rounded-xl bg-white/[0.07] px-3 py-2.5 text-[16px] leading-snug text-white ring-1 ring-white/10 placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <button type="button" className={cn(btnPrimary, "w-full")} disabled={!themeIdea.trim()} onClick={() => void copyThemePrompt()}>
              {copiedTheme ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <Copy className="h-5 w-5" aria-hidden />}
              {copiedTheme ? "Copied" : "Copy prompt"}
            </button>
            <p className="text-[13px] text-white/50">Paste it into a new Claude chat. Claude builds the theme on the Pi and adds it here when it's done.</p>
          </div>
        </DisclosureRow>
      </Group>

      </div>
      <div className="flex min-w-0 flex-col gap-6 xl:col-start-2 xl:row-start-2 2xl:col-start-3 2xl:row-start-1">
      <h2 className="hidden px-1 text-[20px] font-semibold tracking-tight text-white xl:block">Sound</h2>
      {/* Sound: projector speaker + wall chimes. Google TV's home screen is always muted by the Pi (autoplay guard). */}
      <Group title="Sound" footer="Wall sounds follow Do Not Disturb. Google TV's home screen is kept silent so previews can't blast through the wall.">
        <div className="flex min-h-[52px] items-center gap-3 border-b border-white/[0.07] px-4 py-3">
          <VolumeX className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
          <Slider aria-label="Projector volume" min={0} max={100} step={5} value={[volDraft ?? s.volume ?? 100]}
            onValueChange={(v) => setVolDraft(v[0])} onValueCommit={(v) => { setVolDraft(null); act({ volume: v[0] }, `Volume ${v[0]}%.`); }} className="flex-1" />
          <Volume2 className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
          <span className="w-12 whitespace-nowrap text-right text-[15px] tabular-nums text-white/80">{volDraft ?? s.volume ?? 100}%</span>
        </div>
        <Row label="Wall sounds" detail="Chimes and whooshes when things change on the wall." htmlFor="wall-sound">
          <Switch className={swHit} id="wall-sound" checked={s.sound !== false} onCheckedChange={(v) => act({ sound: v }, v ? "Wall sounds on." : "Wall sounds off.")} />
        </Row>
        <div className="px-4 py-3">
          <Segmented label="Sound style" value={s.soundPack ?? "glass"}
            onChange={(v) => act({ soundPack: v, soundTest: Date.now() }, "Sound style changed. Playing a sample.")}
            options={[{ id: "glass", label: "Glass" }, { id: "marimba", label: "Marimba" }, { id: "keys", label: "Soft keys" }]} />
        </div>
      </Group>

      {/* Radio: Radio Browser stations -> state.radio {on, name, url, favicon, ts}; the Pi plays it on the Desk HomePod. */}
      <WallRadioSection radio={s.radio} live={st?.radio ?? null}
        onPlay={(r) => act({ radio: r }, `Playing ${r.name.split(/\s+[-|–]\s+/)[0]} on the Desk HomePod.`)}
        onStop={() => act({ radio: s.radio ? { ...s.radio, on: false, ts: Date.now() } : null }, "Radio stopped.")} />

      {/* AirPlay: the Pi is an AirPlay receiver ("Bestly Wall"); video plays where the clock and today are. */}
      {(() => {
        const off = s.airplay === false;
        const fresh = !!ap && ap.age_s != null && ap.age_s < 90 && statusAge != null && statusAge < 150;
        const since = ap?.since ? time12(ap.since * 1000) : null;
        const detail = off ? "Off. Your phone won't see the wall."
          : !ap ? "Checking with the Pi…"
          : ap.casting ? <>Playing {ap.kind === "audio" ? "audio" : "video"}{since ? <> since <NW>{since}</NW></> : ""}{ap.page && ap.page.startsWith("playing") ? "" : " · connecting on the wall"}</>
          : ap.on && fresh ? "Ready. On your iPhone: Control Center, Screen Mirroring, Bestly\u00a0Wall."
          : "Not running right now. The Pi keeps retrying and Scout will tell you if it stays down.";
        return (
          <Group title="AirPlay" footer="Mirror your iPhone or Mac, or AirPlay a video to Bestly Wall. It plays where the clock is and the rest of the wall moves over. Anyone on your Wi-Fi can pick it.">
            <Row htmlFor="wall-airplay" label={<span className="inline-flex items-center gap-2"><Airplay className="h-4 w-4 text-white/60" aria-hidden />Bestly Wall in AirPlay</span>}
              detail={<span className={cn(!off && ap && !ap.casting && !(ap.on && fresh) && "text-amber-300")}>{detail}{ap?.rtc === "no-h264" ? " The projector's browser can't play this video format." : ""}</span>}>
              <Switch className={swHit} id="wall-airplay" checked={!off} onCheckedChange={(v) => act({ airplay: v }, v ? "AirPlay on." : "AirPlay off.")} />
            </Row>
            <div className="px-4 py-2">
              <button type="button" className="inline-flex min-h-[44px] items-center gap-2 text-[15px] font-medium text-sky-400 disabled:opacity-40" disabled={off} onClick={() => void restartAirplay()}>
                <RotateCw className="h-4 w-4" aria-hidden /> Restart AirPlay
              </button>
              {apMsg && <p className="text-[13px] text-white/60" role="status">{apMsg}</p>}
            </div>
          </Group>
        );
      })()}

      </div>
      <div className="flex min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-2 2xl:col-start-3 2xl:row-start-2">
      <h2 className="hidden px-1 text-[20px] font-semibold tracking-tight text-white xl:block">Sky and guests</h2>
      {/* Sign the wall */}
      <Group title="Sign the wall"
        footer={<>Guests tap a coaster (NFC), sign with a finger, and it writes itself onto the left wall. Auto shows names when someone is near or right after a new signature.</>}>
        <div className="space-y-3 px-4 py-3">
          <Segmented label="Show names" value={s.signShow ?? "auto"} onChange={(v) => act({ signShow: v }, `Names: ${v === "auto" ? "Auto" : v === "on" ? "Always" : "Off"}.`)}
            options={[{ id: "auto", label: "Auto" }, { id: "on", label: "Always" }, { id: "off", label: "Off" }]} />
          <div className="grid grid-cols-2 gap-2">
            <a className={cn(btn, "px-2")} href="/sign/jg8h" target="_blank" rel="noreferrer">
              <Nfc className="h-4 w-4 shrink-0" aria-hidden /> Guest page
            </a>
            <button type="button" className={cn(btn, "px-2", confirmClear && "text-red-400 ring-red-400/60")}
              onClick={() => { if (confirmClear) { setConfirmClear(false); void signAction("clear"); } else { setConfirmClear(true); window.setTimeout(() => setConfirmClear(false), 4000); } }}>
              <EyeOff className="h-4 w-4 shrink-0" aria-hidden /> {confirmClear ? "Tap to confirm" : "Clear the wall"}
            </button>
          </div>
          {signMsg && <p className="text-[13px] text-white/60" role="status">{signMsg}</p>}
        </div>
        {(showAllSigs ? sigs : sigs.slice(0, 3)).map((g) => (
          <Row key={g.id} label={<span style={{ color: g.color }}>{g.name || "No name"}{g.emoji ? <span aria-label={`emoji ${g.emoji}`}> {g.emoji}</span> : null}{g.test ? " · test" : ""}{g.hidden ? <span className="text-white/40"> · hidden</span> : null}</span>}
            detail={<NW>{new Date(g.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</NW>}>
            <div className="flex gap-2">
              <button type="button" className={cn(btn, "w-11 px-0")} aria-label={g.hidden ? `Show ${g.name || "signature"} on the wall` : `Hide ${g.name || "signature"} from the wall`}
                onClick={() => void signAction(g.hidden ? "show" : "hide", g.id)}>
                {g.hidden ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
              </button>
              <button type="button" aria-label={confirmDel === g.id ? "Tap again to delete for good" : `Delete ${g.name || "signature"}`}
                className={cn(btn, "px-3 text-[14px] text-red-400", confirmDel === g.id ? "bg-red-500/15 ring-red-400/60" : "w-11 px-0")}
                onClick={() => {
                  if (confirmDel === g.id) { setConfirmDel(null); void signAction("delete", g.id); }
                  else { setConfirmDel(g.id); window.setTimeout(() => setConfirmDel((c) => (c === g.id ? null : c)), 4000); }
                }}>
                <Trash2 className="h-4 w-4" aria-hidden />{confirmDel === g.id && " Delete"}
              </button>
            </div>
          </Row>
        ))}
        {sigs.length > 3 && (
          <div className="px-4">
            <button type="button" className="min-h-[44px] text-[15px] font-medium text-sky-400" onClick={() => setShowAllSigs((v) => !v)}>
              {showAllSigs ? "Show fewer" : `Show all ${sigs.length} signatures`}
            </button>
          </div>
        )}
      </Group>

      {/* Sky: live planes over the house, plus stars, moon, sun and planets */}
      <Group title="Sky on the ceiling">
        <Row label={<span className="inline-flex items-center gap-2"><Plane className="h-4 w-4 text-white/60" aria-hidden /> Planes overhead</span>} detail="Live planes and helicopters over the house, above the strip." htmlFor="wall-air">
          <Switch className={swHit} id="wall-air" checked={s.airShow !== false} onCheckedChange={(v) => act({ airShow: v }, v ? "Planes overhead on." : "Planes overhead off.")} />
        </Row>
        {s.airShow !== false && (() => {
          const rad = Math.min(25, Math.max(2, Math.round(s.airRadiusMi ?? 15)));
          const setRad = (n: number) => change({ airRadiusMi: Math.min(25, Math.max(2, n)) });
          return (
            <Row label="Sky radius" detail="Only planes this close to home show on the ceiling. The sky key shows it too.">
              <div role="group" aria-label="Sky radius" className="flex shrink-0 items-center gap-1">
                <button type="button" className={cn(btn, "w-11 px-0")} aria-label="Smaller radius" disabled={rad <= 2} onClick={() => setRad(rad - 1)}>
                  <Minus className="h-5 w-5" aria-hidden />
                </button>
                <span className="w-16 whitespace-nowrap text-center text-[17px] font-medium tabular-nums text-white" aria-live="polite">{rad}{"\u00a0"}mi</span>
                <button type="button" className={cn(btn, "w-11 px-0")} aria-label="Bigger radius" disabled={rad >= 25} onClick={() => setRad(rad + 1)}>
                  <Plus className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </Row>
          );
        })()}
        <Row label={<span className="inline-flex items-center gap-2"><RadioTower className="h-4 w-4 text-white/60" aria-hidden /> Air traffic control</span>}
          detail="Live LAX tower radio on the Desk HomePod. Turns the radio off." htmlFor="wall-atc">
          <Switch className={swHit} id="wall-atc" checked={!!s.atc && !s.radio?.on}
            onCheckedChange={(v) => act(v ? { atc: true, ...(s.radio?.on ? { radio: { ...s.radio, on: false, ts: Date.now() } } : {}) } : { atc: false },
              v ? "LAX tower is playing on the Desk HomePod." : "Air traffic control off.")} />
        </Row>
        <DisclosureRow id="sky-details" label="Sky details" summary="Plane card, labels, home, space station, stars, moon, sun, planets, key">
          {s.airShow !== false && <>
            <Row label="Home marker" detail="A small house where you are, in the middle of the sky map." htmlFor="wall-sky-home">
              <Switch className={swHit} id="wall-sky-home" checked={s.skyHome !== false} onCheckedChange={(v) => change({ skyHome: v })} />
            </Row>
            <Row label="Landmarks" detail="City labels, the downtown skyline, and the LAX runways on the sky map." htmlFor="wall-sky-landmarks">
              <Switch className={swHit} id="wall-sky-landmarks" checked={s.skyLandmarks !== false} onCheckedChange={(v) => change({ skyLandmarks: v })} />
            </Row>
            <Row label="Roads" detail="Street grid around home and freeways across the basin (OpenStreetMap)." htmlFor="wall-sky-roads">
              <Switch className={swHit} id="wall-sky-roads" checked={s.skyRoads !== false} onCheckedChange={(v) => change({ skyRoads: v })} />
            </Row>
            <Row label="Traffic" detail="Live congestion colors on the roads (TomTom; the Pi refreshes every 15 min)." htmlFor="wall-sky-traffic">
              <Switch className={swHit} id="wall-sky-traffic" checked={s.skyTraffic !== false} onCheckedChange={(v) => change({ skyTraffic: v })} />
            </Row>
            <Row label="Space Station name" detail="The name under the Space Station when it passes over." htmlFor="wall-iss-tag">
              <Switch className={swHit} id="wall-iss-tag" checked={s.issTag !== false} onCheckedChange={(v) => change({ issTag: v })} />
            </Row>
            <Row label="Nearest-plane card" detail="The big card that names the closest aircraft." htmlFor="wall-air-card">
              <Switch className={swHit} id="wall-air-card" checked={s.airCard !== false} onCheckedChange={(v) => change({ airCard: v })} />
            </Row>
            <Row label="Keep flight card up" htmlFor="wall-air-card-pin" dim={s.airCard === false}
              detail={s.airCard === false ? "Turn on Nearest-plane card to use this." : "The card stays up and rotates through the planes in view. The closest plane gets its own color."}>
              <Switch className={swHit} id="wall-air-card-pin" disabled={s.airCard === false} checked={!!s.airCardPin}
                onCheckedChange={(v) => act({ airCardPin: v }, v ? "Flight card stays up and rotates through planes." : "Flight card shows only for the closest plane.")} />
            </Row>
            {s.airCard !== false && (
              <Row label="Helicopters in the card" detail="Off: helicopters (like LAPD circling) never take the big card. They still fly across." htmlFor="wall-air-card-heli">
                <Switch className={swHit} id="wall-air-card-heli" checked={s.airCardHeli !== false} onCheckedChange={(v) => change({ airCardHeli: v })} />
              </Row>
            )}
            <Row label="Plane labels" detail="Name tags next to each plane and helicopter." htmlFor="wall-air-labels">
              <Switch className={swHit} id="wall-air-labels" checked={s.airLabels !== false} onCheckedChange={(v) => change({ airLabels: v })} />
            </Row>
            <Row label="Tags on small planes & helicopters" htmlFor="wall-air-labels-small" dim={s.airLabels === false}
              detail={s.airLabels === false ? "Turn on Plane labels to use this." : "Off: only airline flights get a name tag."}>
              <Switch className={swHit} id="wall-air-labels-small" disabled={s.airLabels === false} checked={s.airLabelsSmall !== false}
                onCheckedChange={(v) => act({ airLabelsSmall: v }, v ? "Tags on every plane and helicopter." : "Tags on airline flights only.")} />
            </Row>
            <Row label="Stars and constellations" detail="Bright stars plus Orion and the Big Dipper, at night." htmlFor="wall-sky-stars">
              <Switch className={swHit} id="wall-sky-stars" checked={s.skyStars !== false} onCheckedChange={(v) => change({ skyStars: v })} />
            </Row>
            <Row label="Star names" htmlFor="wall-sky-star-labels" dim={s.skyStars === false}
              detail={s.skyStars === false ? "Turn on Stars and constellations to use this." : "Show the names of bright stars and constellations."}>
              <Switch className={swHit} id="wall-sky-star-labels" disabled={s.skyStars === false} checked={s.skyStarLabels !== false} onCheckedChange={(v) => change({ skyStarLabels: v })} />
            </Row>
            <Row label="Sky grid" htmlFor="wall-sky-grid" dim={s.skyStars === false}
              detail={s.skyStars === false ? "Turn on Stars and constellations to use this." : "A faint planetarium grid over the stars (only while stars are on)."}>
              <Switch className={swHit} id="wall-sky-grid" disabled={s.skyStars === false} checked={s.skyGrid !== false} onCheckedChange={(v) => change({ skyGrid: v })} />
            </Row>
            <Row label="Moon" detail="Where the moon is, with tonight's real phase." htmlFor="wall-sky-moon">
              <Switch className={swHit} id="wall-sky-moon" checked={s.skyMoon !== false} onCheckedChange={(v) => change({ skyMoon: v })} />
            </Row>
            <Row label="Sun" detail="Where the sun is, while it's up." htmlFor="wall-sky-sun">
              <Switch className={swHit} id="wall-sky-sun" checked={s.skySun !== false} onCheckedChange={(v) => change({ skySun: v })} />
            </Row>
            <Row label="Planets" detail="Mercury to Saturn when they're up at dusk and night." htmlFor="wall-sky-planets">
              <Switch className={swHit} id="wall-sky-planets" checked={s.skyPlanets !== false} onCheckedChange={(v) => change({ skyPlanets: v })} />
            </Row>
          </>}
          <Row label="Sky key" detail="Explains the colors and symbols on the ceiling. Handy when showing people." htmlFor="wall-air-key">
            <Switch className={swHit} id="wall-air-key" checked={!!s.airKey} onCheckedChange={(v) => change({ airKey: v })} />
          </Row>
        </DisclosureRow>
      </Group>

      </div>
      </div>

      {/* Advanced: rarely used tools, one tap away */}
      <Disclosure id="advanced" title="Advanced" summary="Projector health and power, alignment, sky fit, tests">
        <div className="grid items-start gap-6 xl:grid-cols-2 xl:gap-8">
        <div className="min-w-0 space-y-6">
        <ProjectorHealth health={st?.health} />

        <Group title="Projector" footer={powerMsg ?? "Turn on and Turn off hold until the next switch at 7\u00a0AM or midnight."}>
          <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-4">
            <button type="button" className={btn} onClick={() => void power(true)}><Sun className="h-5 w-5" aria-hidden /> Turn on</button>
            <button type="button" className={btn} onClick={() => void power(false)}><Moon className="h-5 w-5" aria-hidden /> Turn off</button>
            <button type="button" className={btn} onClick={() => void focus()}><Focus className="h-5 w-5" aria-hidden /> Focus</button>
            <button type="button" className={btn} onClick={() => void restartWall()}><RotateCw className="h-5 w-5" aria-hidden /> Restart</button>
          </div>
          <Row label="Sign wall focus"
            detail={<>
              One lens can only be sharpest at one distance, and the sign wall sits a few inches behind the strip. Nudge until both look good; the wall remembers it and puts it back after Focus and every morning.
              {st?.focus?.tuned ? <> Saved: <NW>{st.focus.offset ?? 0} {Math.abs(st.focus.offset ?? 0) === 1 ? "step" : "steps"}</NW> from autofocus.</> : null}
              {st?.focus?.err ? <span className="text-amber-300"> {st.focus.err}</span> : null}
            </>}>
            <div className="flex shrink-0 gap-2" role="group" aria-label="Nudge focus">
              <button type="button" className={cn(btn, "px-3")} disabled={!!st?.focus?.busy} onClick={() => void nudgeFocus("focus_left")} aria-label="Nudge focus left">
                <ArrowLeft className="h-5 w-5" aria-hidden />
              </button>
              <button type="button" className={cn(btn, "px-3")} disabled={!!st?.focus?.busy} onClick={() => void nudgeFocus("focus_right")} aria-label="Nudge focus right">
                <ArrowRight className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </Row>
          <Row label="Auto keystone" detail="Off keeps the picture square so your alignment doesn't shift. Turn on only if you move the projector." htmlFor="wall-keystone">
            <Switch className={swHit} id="wall-keystone" checked={!!s.autoKeystone} onCheckedChange={(v) => act({ autoKeystone: v }, v ? "Auto keystone on." : "Auto keystone off.")} />
          </Row>
          <Row label="Away mode" detail="Taking it to a gig. The Pi won't wake it, open the wall or send offline alerts." htmlFor="wall-away">
            <Switch className={swHit} id="wall-away" checked={s.away} onCheckedChange={(v) => act({ away: v }, v ? "Away mode on. The Pi leaves the projector alone." : "Away mode off.")} />
          </Row>
        </Group>

        {/* Electricity: live watts + LADWP cost estimate (server.py power_loop via the watchdog status) */}
        <WallPowerCost meter={st?.power_meter} />

        <Group title="Sky fit" footer="The sky is a map seen from below. These make planes move the right way from your desk.">
          <Row label="Wall faces" detail="The direction your wall faces." htmlFor="wall-bearing">
            <select id="wall-bearing" value={String(s.airBearing ?? 0)} onChange={(e) => act({ airBearing: Number(e.target.value) }, "Sky direction saved.")}
              className="min-h-[44px] rounded-lg bg-white/[0.08] px-3 text-[16px] text-white ring-1 ring-white/15 focus:outline-none focus:ring-2 focus:ring-sky-400">
              {["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"].map((n, i) => <option key={n} value={i * 45}>{n}</option>)}
            </select>
          </Row>
          {(() => {
            // W1 round 4: move "home" on the ceiling; the whole sky (planes, rings, sun, moon, stars) re-centers on it
            const hp = s.homePos ?? { x: 0.5, y: 0.5 };
            const nudge = (dx: number, dy: number) => {
              const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
              change({ homePos: { x: r(hp.x + dx), y: r(hp.y + dy) } });
            };
            const off = !s.homePos || (Math.abs(hp.x - 0.5) < 0.005 && Math.abs(hp.y - 0.5) < 0.005);
            return (
              <Row label="Home on the sky" detail={off ? "In the middle of the sky. Nudge it to where your desk really is." : `Moved ${Math.round(Math.abs(hp.x - 0.5) * 100)}% ${hp.x < 0.5 ? "left" : "right"}, ${Math.round(Math.abs(hp.y - 0.5) * 100)}% ${hp.y < 0.5 ? "up" : "down"}. The whole sky moves with it.`}>
                <div role="group" aria-label="Move home on the sky" className="grid shrink-0 grid-cols-3 gap-1">
                  <span />
                  <button type="button" className={cn(btn, "w-11 px-0")} aria-label="Move home up" onClick={() => nudge(0, -0.05)}><ArrowUp className="h-5 w-5" aria-hidden /></button>
                  <span />
                  <button type="button" className={cn(btn, "w-11 px-0")} aria-label="Move home left" onClick={() => nudge(-0.05, 0)}><ArrowLeft className="h-5 w-5" aria-hidden /></button>
                  <button type="button" className={cn(btn, "w-11 px-0 text-[13px]")} aria-label="Put home back in the middle" disabled={off} onClick={() => change({ homePos: null })}>Mid</button>
                  <button type="button" className={cn(btn, "w-11 px-0")} aria-label="Move home right" onClick={() => nudge(0.05, 0)}><ArrowRight className="h-5 w-5" aria-hidden /></button>
                  <span />
                  <button type="button" className={cn(btn, "w-11 px-0")} aria-label="Move home down" onClick={() => nudge(0, 0.05)}><ArrowDown className="h-5 w-5" aria-hidden /></button>
                  <span />
                </div>
              </Row>
            );
          })()}
        </Group>

        <Group title="Tests" footer="Real alerts show on their own: move the car on sweeping mornings, and anything Scout flags.">
          <Row label="Move-car alert" htmlFor="wall-t-sweep">
            <Switch className={swHit} id="wall-t-sweep" checked={s.testSweep} onCheckedChange={(v) => change({ testSweep: v })} />
          </Row>
          <Row label="Scout alert" htmlFor="wall-t-scout">
            <Switch className={swHit} id="wall-t-scout" checked={s.testScout} onCheckedChange={(v) => change({ testScout: v })} />
          </Row>
          <div className="grid grid-cols-2 gap-2 px-4 py-3">
            <button type="button" className={cn(btn, "px-2")} onClick={() => void signAction("test")}>
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden /> Test signature
            </button>
            <button type="button" className={cn(btn, "px-2")} onClick={() => act({ signNear: Date.now() }, "Showing names like someone walked up.")}>
              <UserRound className="h-4 w-4 shrink-0" aria-hidden /> Someone's near
            </button>
            <button type="button" className={cn(btn, "px-2")} onClick={() => act({ soundTest: Date.now() }, "Playing every wall sound: chime, mode switch, alert, signature, celebration.")}>
              <Volume2 className="h-4 w-4 shrink-0" aria-hidden /> Every sound
            </button>
            <button type="button" className={cn(btn, "px-2")} onClick={() => act({ fxPlay: { name: "show", at: Date.now() } }, "The wall powers down, then wakes back up.")}>
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden /> Wake + sleep
            </button>
          </div>
        </Group>
        </div>
        <div className="min-w-0 space-y-6">
        <Group title="Alignment"
          footer={tool === "air"
            ? "The violet box is the sky: live planes fly across it. Put it on the open wall above the strip."
            : tool === "wing"
            ? "The teal box is the Sign the wall area. Drag it onto the open wall on the left. Bars stretch a side; Bigger and Smaller keep the shape."
            : tool === "corners"
            ? "The black box is the projector's whole picture. Drag the white dots onto the corners of your strip. Bars stretch one side, the blue dot moves everything, and Bigger and Smaller keep the shape."
            : "Drag the orange dots over the shadow where the TV blocks the light. The wall stays dark there and moves text out of the way."}>
          <div className="space-y-2 px-4 py-3">
            <button type="button" className={cn(btnPrimary, "w-full")}
              onClick={async () => {
                change({ calGrid: true });
                const prompt = "Wall alignment: the alignment grid is on the wall now. I'm attaching 2 photos taken from where I usually sit (one with the lights on, one with the lights off). Re-fit the strip, the sign wall, the blocked TV area and the sky (fill the whole ceiling, text and planes must look straight from where I sit). Save it, turn the grid off, and check it on the projector. Use the wall-realign skill.";
                await copyText(prompt);
                setCopiedAlign(true); setTimeout(() => setCopiedAlign(false), 2500);
                toast.success("Grid is on and the prompt is copied. Take 2 photos from your usual spot.", { id: "wall-act" });
              }}>
              {copiedAlign ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <Copy className="h-5 w-5" aria-hidden />}
              {copiedAlign ? "Copied. Grid is on" : "Re-align with Claude"}
            </button>
            <p className="text-[13px] text-white/50">Turns on the grid and copies a prompt. Take 2 photos from your usual spot (lights on and off) and paste the prompt with them to Claude.</p>
          </div>
          <Row label="Alignment grid" detail="Fills the projector with a labeled grid. While you adjust, the block you picked below glows on the wall." htmlFor="wall-cal">
            <Switch className={swHit} id="wall-cal" checked={!!s.calGrid} onCheckedChange={(v) => change({ calGrid: v })} />
          </Row>
          <Row label="Move everything together" detail="Bumped the projector? Drag the blue dot and every area slides as one." htmlFor="wall-link">
            <Switch className={swHit} id="wall-link" checked={linkAll} onCheckedChange={setLinkAll} />
          </Row>
          <Row label="Show guides on the wall" detail="Outlines the strip and blocked area so you can line them up." htmlFor="wall-guides">
            <Switch className={swHit} id="wall-guides" checked={s.mapping} onCheckedChange={(v) => change({ mapping: v })} />
          </Row>
          <div className="space-y-3 px-4 py-3">
            <UndoKeys onUndo={doUndo} onRedo={doRedo} />
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 text-[13px] text-white/55" aria-live="polite">
                {editing ? "Editing. Drag the dots, then tap Done." : "Locked, so a stray swipe can't move the wall."}
              </p>
              <button type="button" aria-pressed={editing} onClick={() => setEditing((v) => !v)}
                className={cn(btn, "shrink-0", editing && "font-semibold text-sky-400")}>
                {editing ? <Check className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
                {editing ? "Done" : "Edit layout"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Undo and redo layout changes">
              {([["undo", nextUndo, Undo2], ["redo", nextRedo, Redo2]] as const).map(([dir, st, Icon]) => {
                const name = dir === "undo" ? "Undo" : "Redo";
                const when = st ? stepTime(st) : "";
                const keys = dir === "undo" ? (isMac ? "\u2318Z" : "Ctrl+Z") : (isMac ? "\u21E7\u2318Z" : "Ctrl+Shift+Z");
                return (
                  <button key={dir} type="button" disabled={!st || geoWorking} onClick={dir === "undo" ? doUndo : doRedo}
                    aria-label={st ? `${name}: ${st.reason}${when ? `, ${when}` : ""}` : `Nothing to ${dir}`}
                    title={`${name} (${keys})`} aria-keyshortcuts={dir === "undo" ? "Meta+Z Control+Z" : "Meta+Shift+Z Control+Shift+Z"}
                    className={cn(btn, "min-h-[52px] min-w-0 flex-col items-start justify-center gap-0 px-3 py-1.5 text-left")}>
                    <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                      {geoWorking ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
                      {name}
                    </span>
                    <span className="block w-full truncate text-[12px] font-normal text-white/55">
                      {st ? <>{st.reason}{when && <> · <NW>{when}</NW></>}</> : `Nothing to ${dir}`}
                    </span>
                  </button>
                );
              })}
            </div>
            <Segmented compact label="What to adjust" value={tool}
              onChange={(t) => {
                if (t === "mask" && !s.mask) {
                  if (editing) addMask(); else toast("Tap Edit layout first, then add the blocked area.", { id: "wall-act" });
                } else { setTool(t); setSel(0); }
              }}
              options={[{ id: "corners", label: "Strip" }, { id: "mask", label: <><Triangle className="h-4 w-4" aria-hidden /> Blocked</> }, { id: "wing", label: <><PenLine className="h-4 w-4" aria-hidden /> Sign</> }, { id: "air", label: <><Plane className="h-4 w-4" aria-hidden /> Sky</> }]} />
          <div ref={padRef} className={cn("relative aspect-video w-full select-none overflow-hidden rounded-xl ring-1 ring-white/15", editing ? "touch-none" : "touch-pan-y")} style={{ background: "#000" }}>
            <svg viewBox="0 0 1600 900" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
              <polygon points={s.corners.map(([x, y]) => `${x * 1600},${y * 900}`).join(" ")}
                fill="rgba(255,248,236,0.14)" stroke="#FFF8EC" strokeWidth={tool === "corners" ? 5 : 3} />
              <polygon points={(s.air ?? DEFAULT_AIR).map(([x, y]) => `${x * 1600},${y * 900}`).join(" ")}
                fill="rgba(191,90,242,0.14)" stroke="#BF5AF2" strokeWidth={tool === "air" ? 5 : 2} strokeDasharray={tool === "air" ? undefined : "14 10"} />
              <polygon points={(s.wing ?? DEFAULT_WING).map(([x, y]) => `${x * 1600},${y * 900}`).join(" ")}
                fill="rgba(100,210,255,0.16)" stroke="#64D2FF" strokeWidth={tool === "wing" ? 5 : 2} strokeDasharray={tool === "wing" ? undefined : "14 10"} />
              {s.mask && (
                <polygon points={s.mask.map(([x, y]) => `${x * 1600},${y * 900}`).join(" ")}
                  fill="rgba(255,149,0,0.28)" stroke="#FF9500" strokeWidth={tool === "mask" ? 5 : 3} />
              )}
            </svg>
            {tool !== "mask" && quad && quad.map((a, n) => {
              const b = quad[(n + 1) % quad.length];
              const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
              const deg = (Math.atan2((b[1] - a[1]) * 9, (b[0] - a[0]) * 16) * 180) / Math.PI;
              const id = EDGE + n;
              return (
                <button key={`edge-${n}`} type="button" disabled={!editing}
                  aria-label={`Stretch the ${["top", "right", "bottom", "left"][n]} side`}
                  aria-pressed={sel === id}
                  onPointerDown={startDrag(id)} onFocus={() => setSel(id)}
                  onKeyDown={(e) => {
                    const k: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
                    if (k[e.key]) { e.preventDefault(); nudge(...k[e.key]); }
                  }}
                  style={{ left: `${mx * 100}%`, top: `${my * 100}%`, transform: `rotate(${deg}deg)` }}
                  className="absolute -ml-[22px] -mt-[22px] flex h-11 w-11 touch-none items-center justify-center focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50">
                  <span className={cn(
                    "block h-[9px] w-7 rounded-full border-2 border-black bg-[#FFF8EC] shadow-[0_0_0_2px_rgba(0,0,0,0.55)] transition-transform duration-100",
                    sel === id && "scale-125 ring-4 ring-sky-400/70",
                  )} />
                </button>
              );
            })}
            {handles.map((p, i) => {
              const isAll = i === handles.length - 1;
              return (
                <button key={`${tool}-${i}`} type="button" disabled={!editing}
                  aria-label={isAll ? "Move the whole shape" : `${tool === "mask" ? "Blocked area" : tool === "wing" ? "Sign wall" : tool === "air" ? "Sky" : "Corner"} point ${i + 1}`}
                  aria-pressed={sel === i}
                  onPointerDown={startDrag(i)} onFocus={() => setSel(i)}
                  onKeyDown={(e) => {
                    const k: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
                    if (k[e.key]) { e.preventDefault(); nudge(...k[e.key]); }
                  }}
                  style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
                  className="absolute -ml-[22px] -mt-[22px] flex h-11 w-11 touch-none items-center justify-center rounded-full focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50">
                  <span className={cn(
                    "block h-5 w-5 rounded-full border-[2.5px] shadow-[0_0_0_2px_rgba(0,0,0,0.55)] transition-transform duration-100",
                    isAll ? "border-white bg-sky-400" : tool === "mask" ? "border-white bg-orange-400" : tool === "wing" ? "border-black bg-[#64D2FF]" : tool === "air" ? "border-black bg-[#BF5AF2]" : "border-black bg-[#FFF8EC]",
                    sel === i && "scale-125 ring-4 ring-sky-400/70",
                  )} />
                </button>
              );
            })}
            {!editing && (
              <span className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-black/70 px-3 py-1 text-[12px] text-white/80 ring-1 ring-white/15">
                <Lock className="h-3 w-3" aria-hidden /> Locked
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Nudge the selected point">
              <span />
              <button type="button" disabled={!editing} aria-label="Nudge up" className={cn(btn, "w-11 px-0")} onClick={() => nudge(0, -1)}><ArrowUp className="h-5 w-5" /></button>
              <span />
              <button type="button" disabled={!editing} aria-label="Nudge left" className={cn(btn, "w-11 px-0")} onClick={() => nudge(-1, 0)}><ArrowLeft className="h-5 w-5" /></button>
              <span className="flex h-11 w-11 items-center justify-center text-[12px] text-white/45">{sel >= EDGE ? ["Top", "Right", "Bottom", "Left"][sel - EDGE] : sel === handles.length - 1 ? "All" : sel + 1}</span>
              <button type="button" disabled={!editing} aria-label="Nudge right" className={cn(btn, "w-11 px-0")} onClick={() => nudge(1, 0)}><ArrowRight className="h-5 w-5" /></button>
              <span />
              <button type="button" disabled={!editing} aria-label="Nudge down" className={cn(btn, "w-11 px-0")} onClick={() => nudge(0, 1)}><ArrowDown className="h-5 w-5" /></button>
              <span />
            </div>
            <div className="min-w-[180px] flex-1 space-y-2">
              <Segmented label="Drag precision" value={fine ? "fine" : "fast"} onChange={(v) => setFine(v === "fine")}
                options={[{ id: "fine", label: "Precise" }, { id: "fast", label: "Fast" }]} />
              {tool !== "mask" ? (
                <>
                  <div className="flex gap-2" role="group" aria-label="Resize the strip, same shape">
                    <button type="button" disabled={!editing} className={cn(btn, "flex-1")} onClick={() => scale(false)}>
                      <Minimize2 className="h-4 w-4" aria-hidden /> Smaller
                    </button>
                    <button type="button" disabled={!editing} className={cn(btn, "flex-1")} onClick={() => scale(true)}>
                      <Maximize2 className="h-4 w-4" aria-hidden /> Bigger
                    </button>
                  </div>
                  <button type="button" disabled={!editing} className={cn(btn, "w-full")} onClick={() => change(tool === "wing" ? { wing: DEFAULT_WING } : tool === "air" ? { air: DEFAULT_AIR } : { corners: DEFAULT_CORNERS })}>
                    <RotateCcw className="h-4 w-4" aria-hidden /> {tool === "wing" ? "Reset sign wall" : tool === "air" ? "Reset sky" : "Reset corners"}
                  </button>
                </>
              ) : (
                <div className="flex gap-2">
                  {s.mask && s.mask.length < 6 && (
                    <button type="button" disabled={!editing} className={cn(btn, "flex-1")} onClick={() => {
                      const m = s.mask!; const a = m[m.length - 1], b = m[0];
                      change({ mask: [...m, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]] });
                    }}>Add point</button>
                  )}
                  <button type="button" disabled={!editing} className={cn(btn, "flex-1 text-red-400")} onClick={() => { change({ mask: null }); setTool("corners"); setSel(0); }}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </Group>

      {/* W8 round 4: the projection-mapped neon sign on the sign wall (glow, looks, alert animations, fine-align) */}
      <WallLedSign value={s.ledSign} health={(st as { lsign?: LedSignHealth } | null)?.lsign} onChange={(v) => change({ ledSign: v })} />

        </div>
        </div>
      </Disclosure>
    </div>
  );
}
