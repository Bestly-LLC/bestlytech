import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminTheme, adminInk } from "@/hooks/useAdminTheme";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Car, CalendarDays, CheckCircle2, RefreshCw, Send, AlertTriangle, BellOff, Info, Clock3, MapPin, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import { pollInterval } from "@/lib/polling";
import {
  SweepState,
  SweepOutcome,
  CurbSide,
  CarStatus,
  carPlacement,
  fetchSweepState,
  setAlertsEnabled,
  setSkipDates,
  acknowledgeToday,
  sendTestAlert,
  calibrateHere,
  upcomingSweepDays,
  nextSweepFor,
  stopsOn,
  zoneSideOn,
  weekdayOf,
  min12,
  DAY_NAMES,
  SweepZone,
  laNowMinutes,
  fmtDay,
  fmtLA,
  ago,
} from "@/services/streetSweepingApi";

const OUTCOME: Record<SweepOutcome, { label: string; className: string }> = {
  alerted: { label: "Alert sent", className: "bg-red-500/10 text-red-300 border-red-500/20" },
  safe_side: { label: "Safe side", className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  not_on_street: { label: "Not on Kings", className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  acknowledged: { label: "Acknowledged", className: "bg-white/[0.06] text-white/60 border-white/10" },
  disabled: { label: "Paused", className: "bg-white/[0.06] text-white/50 border-white/10" },
  skipped: { label: "Skipped day", className: "bg-white/[0.06] text-white/50 border-white/10" },
  location_error: { label: "No location", className: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  outside_window: { label: "Outside window", className: "bg-white/[0.06] text-white/55 border-white/10" },
  test: { label: "Test", className: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20" },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (dow: number | null) => (dow == null ? "never" : DAY_NAMES[dow].slice(0, 3));
const windowOf = (z: SweepZone) => `${min12(z.start_min)}–${min12(z.end_min)}`;
/** "west curb of the 800 block" */
const curbOf = (side: CurbSide, z: SweepZone) => `${side} curb of the ${z.name}`;
const addDaysIso = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const laDateOf = (ts: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

type Tone = "danger" | "ok" | "warn" | "neutral";
const TONE: Record<Tone, string> = {
  danger: "border-red-500/30 bg-red-500/[0.07]",
  ok: "border-emerald-500/25 bg-emerald-500/[0.06]",
  warn: "border-amber-500/25 bg-amber-500/[0.06]",
  neutral: "border-white/[0.06] bg-white/[0.03]",
};

/* ───────── the block, drawn ─────────
 * Overhead view of N Kings Rd, north up. West curb is swept Mondays, east curb Tuesdays.
 * Four states, and none of them is ever told by colour alone — the caption under the drawing
 * says the same thing in words:
 *   on_sweep_curb  car sits in the hatched lane that gets swept next
 *   on_safe_curb   car sits in the other lane
 *   off_street     the block is drawn empty and the car sits outside it
 *   stale/unknown  no claim about now: a ghost car where it was last seen, or an empty slot
 */
function CarGlyph({ x, y, tone, paper, ghost }: { x: number; y: number; tone: string; paper: string; ghost?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={28} height={56} rx={9}
        fill={ghost ? paper : tone}
        stroke={ghost ? tone : "none"}
        strokeWidth={ghost ? 2 : 0}
        strokeDasharray={ghost ? "5 4" : undefined}
        opacity={ghost ? 0.9 : 1} />
      {!ghost && (
        <>
          <rect x={5} y={8} width={18} height={12} rx={4} fill="rgba(255,255,255,0.78)" />
          <rect x={5} y={36} width={18} height={10} rx={4} fill="rgba(255,255,255,0.58)" />
        </>
      )}
      {ghost && <text x={14} y={34} textAnchor="middle" fontSize="13" fill={tone}>?</text>}
    </g>
  );
}

function StreetDiagram({
  status,
  side,
  dangerSide,
  zone,
}: {
  status: CarStatus;
  side: CurbSide | null;
  dangerSide: CurbSide | null;
  zone: SweepZone | null;
}) {
  const { bento } = useAdminTheme();
  const ink = (a: number) => adminInk(bento, a);
  const W = 340;
  const H = 186;
  const road = { x: 34, y: 8, w: 200, h: 130 };
  const laneW = 46;
  const elsewhere = { x: 262, y: 8, w: 66, h: 130 };
  const laneX = (s: CurbSide) => (s === "west" ? road.x + 6 : road.x + road.w - 6 - laneW);
  const carX = (s: CurbSide) => laneX(s) + (laneW - 28) / 2;
  const carY = road.y + (road.h - 56) / 2;

  const sweepFill = bento ? "#FFE3D3" : "rgba(248,113,113,0.12)";
  const safeFill = bento ? "#ECF8D2" : "rgba(74,222,128,0.09)";
  const hatch = bento ? "rgba(178,58,22,0.22)" : "rgba(248,113,113,0.3)";
  const carDanger = bento ? "#D93A1E" : "#f87171";
  const carSafe = bento ? "#111114" : "#c7d2fe";
  const paper = bento ? "#FFFFFF" : "#0b0b0d";

  const onStreet = status === "on_sweep_curb" || status === "on_safe_curb";
  const ghostOnStreet = status === "stale" && !!side;
  const carTone = status === "on_sweep_curb" ? carDanger : carSafe;
  const emptyBlock = status === "unknown" || (status === "stale" && !side);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[21rem] h-auto mx-auto block" role="img" aria-label={DIAGRAM_ALT[status](side)}>
      <defs>
        {/* Hatching, not just colour, marks the curb that gets swept next. */}
        <pattern id="sweep-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke={hatch} strokeWidth="2.5" />
        </pattern>
        <clipPath id="kings-road">
          <rect x={road.x} y={road.y} width={road.w} height={road.h} rx={12} />
        </clipPath>
      </defs>

      {/* sidewalks */}
      <rect x={8} y={road.y} width={20} height={road.h} rx={7} fill={ink(0.05)} />
      <rect x={road.x + road.w + 6} y={road.y} width={20} height={road.h} rx={7} fill={ink(0.05)} />

      {/* the block */}
      <g clipPath="url(#kings-road)">
        <rect x={road.x} y={road.y} width={road.w} height={road.h} fill={ink(0.05)} />
        {(["west", "east"] as CurbSide[]).map((s) => (
          <g key={s}>
            <rect x={laneX(s)} y={road.y} width={laneW} height={road.h} fill={dangerSide === s ? sweepFill : safeFill} />
            {dangerSide === s && <rect x={laneX(s)} y={road.y} width={laneW} height={road.h} fill="url(#sweep-hatch)" />}
          </g>
        ))}
      </g>
      <rect x={road.x} y={road.y} width={road.w} height={road.h} rx={12} fill="none" stroke={ink(0.13)} strokeWidth={1.5} />
      <line
        x1={road.x + road.w / 2} y1={road.y + 12} x2={road.x + road.w / 2} y2={road.y + road.h - 12}
        stroke={bento ? "rgba(202,138,4,0.5)" : "rgba(250,204,21,0.4)"} strokeWidth={2} strokeDasharray="9 8" strokeLinecap="round"
      />

      {/* off-block bay: only drawn when that's where the car is */}
      {status === "off_street" && (
        <>
          <rect x={elsewhere.x} y={elsewhere.y} width={elsewhere.w} height={elsewhere.h} rx={12}
            fill="none" stroke={ink(0.18)} strokeWidth={1.5} strokeDasharray="6 6" />
          <CarGlyph x={elsewhere.x + (elsewhere.w - 28) / 2} y={carY} tone={carSafe} paper={paper} />
          <text x={elsewhere.x + elsewhere.w / 2} y={elsewhere.y + elsewhere.h + 16} textAnchor="middle" fontSize="10.5" fontWeight={600} fill={ink(0.6)}>
            Elsewhere
          </text>
        </>
      )}

      {/* the car */}
      {(onStreet || ghostOnStreet) && side && (
        <CarGlyph x={carX(side)} y={carY} tone={carTone} paper={paper} ghost={!onStreet} />
      )}
      {emptyBlock && (
        <g>
          <rect x={road.x + road.w / 2 - 44} y={road.y + road.h / 2 - 13} width={88} height={26} rx={13} fill={paper} stroke={ink(0.12)} />
          <text x={road.x + road.w / 2} y={road.y + road.h / 2 + 4} textAnchor="middle" fontSize="11.5" fill={ink(0.5)}>
            no reading
          </text>
        </g>
      )}

      {/* curb labels */}
      {(["west", "east"] as CurbSide[]).map((s) => {
        const hot = dangerSide === s;
        return (
          <g key={s}>
            <text x={laneX(s) + laneW / 2} y={road.y + road.h + 16} textAnchor="middle" fontSize="11" fontWeight={600} fill={ink(0.75)}>
              {s === "west" ? "West" : "East"}
            </text>
            <text x={laneX(s) + laneW / 2} y={road.y + road.h + 29} textAnchor="middle" fontSize="10"
              fill={hot ? (bento ? "#B23A16" : "#fca5a5") : ink(0.42)}>
              {hot ? "swept next" : zone ? `${short(s === "west" ? zone.west_dow : zone.east_dow)} 8–10` : ""}
            </text>
          </g>
        );
      })}
      <text x={road.x + road.w / 2} y={H - 6} textAnchor="middle" fontSize="9.5" fontWeight={600} fill={ink(0.38)} letterSpacing="0.08em">
        {zone ? `N KINGS RD · ${zone.name.toUpperCase()}` : "N KINGS RD"}
      </text>
    </svg>
  );
}

const CAR_VALUE: Record<CarStatus, (side: CurbSide | null) => string> = {
  on_sweep_curb: (side) => `${cap(side ?? "")} curb`,
  on_safe_curb: (side) => `${cap(side ?? "")} curb`,
  off_street: () => "Off the swept blocks",
  stale: () => "Not checked",
  unknown: () => "Unknown",
};

const PLACEMENT_HEADLINE: Record<CarStatus, (side: CurbSide | null) => string> = {
  on_sweep_curb: (side) => `On the ${side} curb — the side swept next`,
  on_safe_curb: (side) => `On the ${side} curb — the safe side`,
  off_street: () => "Not parked on a swept block",
  stale: (side) => (side ? `Last seen on the ${side} curb` : "Position is out of date"),
  unknown: () => "Never checked",
};

const PLACEMENT_TEXT: Record<CarStatus, string> = {
  on_sweep_curb: "text-red-300",
  on_safe_curb: "text-emerald-300",
  off_street: "text-white/80",
  stale: "text-white/70",
  unknown: "text-white/70",
};

const PLACEMENT_DETAIL: Record<CarStatus, (side: CurbSide | null, danger: CurbSide | null, ranAt: string | null) => string> = {
  on_sweep_curb: () => "Move it before 8\u00a0AM or it's a $75 ticket.",
  on_safe_curb: (_s, danger) => (danger ? `The ${danger} curb is the one being swept.` : "Nothing to do."),
  off_street: () => "It's away from the blocks we watch, so no alert is coming.",
  stale: (side, _d, ranAt) => side
    ? `The car's feed hasn't updated since ${ranAt ? fmtLA(ranAt) : "the last reading"}, so this is where it was, not necessarily where it is now.`
    : "The car's feed has nothing recent to show.",
  unknown: () => "No position from the car yet.",
};

const DIAGRAM_ALT: Record<CarStatus, (side: CurbSide | null) => string> = {
  on_sweep_curb: (side) => `Blue Steel is parked on the ${side} curb of North Kings Road, the side being swept next`,
  on_safe_curb: (side) => `Blue Steel is parked on the ${side} curb of North Kings Road, the side that isn't swept next`,
  off_street: () => "Blue Steel isn't parked on North Kings Road",
  stale: (side) => side
    ? `Blue Steel was last seen on the ${side} curb of North Kings Road; there has been no check since`
    : "No recent reading of where Blue Steel is parked",
  unknown: () => "No reading of where Blue Steel is parked yet",
};

function BlocksCard({
  zones,
  carZoneId,
  carSide,
  carFresh,
  busy,
  onCalibrate,
}: {
  zones: SweepZone[];
  carZoneId: string | null;
  carSide: CurbSide | null;
  carFresh: boolean;
  busy: boolean;
  onCalibrate: (z: SweepZone, side: CurbSide) => void;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
      <div className="flex items-start gap-2">
        <MapPin className="h-4 w-4 text-white/55 mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">Blocks and calibration</h3>
          <p className="text-xs text-white/50 mt-1">
            Each block of Kings Rd has its own sweep days. Calibration points are spots where you confirmed the curb.
            If the car is ever misread, tap the curb it's really on while it's parked there.
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {zones.map((z) => {
          const here = z.id === carZoneId;
          return (
            <div key={z.id} className={cn("rounded-xl border p-4", here ? "border-indigo-400/30 bg-indigo-500/[0.06]" : "border-white/[0.06] bg-white/[0.02]")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-semibold text-white">{z.name}</p>
                  <p className="text-xs text-white/55">{z.street}, {z.between_streets}</p>
                </div>
                {here && (
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2 py-0.5 text-[0.6875rem] text-indigo-200">
                    <Car className="h-3 w-3" aria-hidden /> Car is here{carSide ? `, ${carSide} curb` : ""}
                  </span>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {(["west", "east"] as CurbSide[]).map((side) => {
                  const dow = side === "west" ? z.west_dow : z.east_dow;
                  return (
                    <div key={side} className="rounded-lg bg-white/[0.04] px-3 py-2">
                      <dt className="text-[0.6875rem] uppercase tracking-wider text-white/50">{side} curb</dt>
                      <dd className="text-white whitespace-nowrap">{dow == null ? "Not swept" : DAY_NAMES[dow]}</dd>
                      <dd className="text-[0.6875rem] text-white/50 whitespace-nowrap">{windowOf(z)} · ${z.fine_usd}</dd>
                    </div>
                  );
                })}
              </dl>
              {z.calibration.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {z.calibration.map((p, i) => (
                    <li key={i} className="text-[0.6875rem] text-white/55 flex gap-1.5">
                      <Crosshair className="h-3 w-3 mt-[0.1rem] shrink-0" aria-hidden />
                      <span>
                        <span className="text-white/75">{fmtDay(p.at)}: {p.side} curb</span>
                        {p.note ? ` · ${p.note}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {here && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["west", "east"] as CurbSide[]).map((side) => (
                    <Button key={side} size="sm" variant="outline" disabled={busy || !carFresh}
                      onClick={() => onCalibrate(z, side)}
                      className="min-h-[44px] border-white/10 text-white/70 hover:text-white hover:bg-white/5">
                      <Crosshair className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                      It's on the {side} curb
                    </Button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StreetSweeping() {
  const [state, setState] = useState<SweepState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only a manual refresh spins the button; background polls stay quiet.
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // At most one pending retry, cancelled on success and on unmount.
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const next = await fetchSweepState();
      if (!mountedRef.current) return;
      setState(next);
      setError(null);
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    } catch (e) {
      if (!mountedRef.current) return;
      setError((e as Error).message);
      // Network blips (sleeping laptop, Wi-Fi hand-off) come back on their own: retry soon.
      if (!retryRef.current) {
        retryRef.current = setTimeout(() => { retryRef.current = null; void poll(); }, 8_000);
      }
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { await poll(); } finally { if (mountedRef.current) setLoading(false); }
  }, [poll]);

  useEffect(() => {
    mountedRef.current = true;
    poll();
    const iv = setInterval(poll, pollInterval(60_000));
    return () => {
      mountedRef.current = false;
      clearInterval(iv);
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    };
  }, [poll]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await poll();
    } catch (e) {
      toast.error((e as Error).message || "That didn't go through");
    } finally {
      setBusy(null);
    }
  };

  const derived = useMemo(() => {
    if (!state) return null;
    const today = state.la_today;
    const zones = state.zones ?? [];
    const skip = state.config.skip_dates;
    const nowMin = laNowMinutes();
    const todayStops = stopsOn(zones, weekdayOf(today));
    const todayList = todayStops.map((t) => curbOf(t.side, t.zone)).join(" and ");
    const days = upcomingSweepDays(today, skip, zones, 6);
    const next = days.find((d) => !d.skipped) ?? null;
    const car = state.car ?? null;
    const where = car?.where ?? null;
    const carZone = where ? zones.find((z) => z.id === where.zone) ?? null : null;
    const todaysChecks = state.runs.filter(
      (r) => laDateOf(r.ran_at) === today && ["alerted", "safe_side", "not_on_street", "location_error"].includes(r.outcome),
    );
    const latestToday = todaysChecks[0] ?? null;
    const inWindowToday = todayStops.length > 0 && nowMin < 600 && !skip.includes(today);
    // Checks log at least every 30 min from 6:55am. Past 7:05 with nothing logged in 40 min, they've stopped.
    const lastCheck = state.runs.find((r) => r.outcome !== "test") ?? null;
    const checksMissing = inWindowToday && nowMin >= 425
      && (!lastCheck || Date.now() - new Date(lastCheck.ran_at).getTime() > 40 * 60_000);
    // When the car's own curb is swept next (the date that matters for it).
    const carNext = carZone && where ? nextSweepFor(today, skip, carZone, where.side) : null;
    const zoneOfRun = (id?: string | null) => zones.find((z) => z.id === id) ?? null;

    let tone: Tone = "neutral";
    let headline = "";
    let detail = "";

    if (!state.config.alerts_enabled) {
      tone = "warn";
      headline = "Alerts are paused";
      detail = "Nothing fires until you switch them back on.";
    } else if (inWindowToday && state.acked_today) {
      tone = "ok";
      headline = "Handled this morning";
      detail = "You acknowledged, so the rest of today's alerts are off.";
    } else if (checksMissing) {
      tone = "danger";
      headline = "No check has run. Check the car yourself.";
      detail = `Swept today, 8–10 AM: ${todayList}. `
        + (latestToday
          ? `Last check ${fmtLA(latestToday.ran_at, { hour: "numeric", minute: "2-digit" })}${latestToday.side ? ` saw it on the ${latestToday.side} curb` : ""}.`
          : "Nothing has checked the car this morning.");
    } else if (inWindowToday && latestToday?.outcome === "alerted") {
      const z = zoneOfRun(latestToday.zone);
      tone = "danger";
      headline = `Move Blue Steel: it's on the ${latestToday.side} curb${z ? ` of the ${z.name}` : ""}`;
      detail = nowMin < 480 ? "Sweeping starts at 8 AM. $75 ticket." : "Sweeping until 10 AM. $75 ticket.";
    } else if (inWindowToday && latestToday?.outcome === "location_error") {
      tone = "warn";
      headline = "Couldn't read the car's location";
      detail = `Check it yourself. Swept today, 8–10 AM: ${todayList}.`;
    } else if (inWindowToday && latestToday) {
      tone = "ok";
      headline = latestToday.outcome === "safe_side" ? "Blue Steel is on a curb that isn't swept today" : "Blue Steel isn't parked on a swept block";
      detail = `Last checked ${fmtLA(latestToday.ran_at, { hour: "numeric", minute: "2-digit" })}. The check runs every 5 min until 10 AM.`;
    } else if (inWindowToday) {
      headline = `Swept today, 8–10 AM: ${todayList}`;
      detail = nowMin < 415 ? "Checks start at 6:55 AM." : "Waiting on the next check.";
    } else if (carNext && where && carZone) {
      // Lead with the sweep that actually applies to where the car is.
      const soon = carNext === today || carNext === addDaysIso(today, 1);
      tone = soon ? "warn" : "neutral";
      headline = `The car's curb is swept ${fmtDay(carNext, { weekday: "long", month: "short", day: "numeric" })}, 8–10 AM`;
      detail = `It's on the ${curbOf(where.side, carZone)} (${carZone.between_streets}). `
        + "Alerts start at 6:55 AM that morning if it's still there.";
    } else if (next) {
      headline = `Next sweep ${fmtDay(next.date, { weekday: "long", month: "short", day: "numeric" })}`;
      detail = `${cap(next.stops.map((t) => curbOf(t.side, t.zone)).join(" and "))}, 8–10 AM.`;
    } else {
      headline = "No sweep days in the next few weeks";
      detail = "Every upcoming sweep day is marked to skip.";
    }

    // The diagram shows the car's block (home block when it's elsewhere); hatch the curb swept next there.
    const diagramZone = carZone ?? zones[0] ?? null;
    let dangerSide: CurbSide | null = null;
    if (diagramZone) {
      const todaySide = inWindowToday ? zoneSideOn(diagramZone, weekdayOf(today)) : null;
      if (todaySide) dangerSide = todaySide;
      else {
        const w = nextSweepFor(today, skip, diagramZone, "west");
        const e = nextSweepFor(today, skip, diagramZone, "east");
        dangerSide = w && (!e || w <= e) ? "west" : e ? "east" : null;
      }
    }
    const placement = carPlacement(car, carZone && where && dangerSide === where.side && diagramZone === carZone ? dangerSide : null);
    return { today, zones, days, next, car, where, carZone, carNext, tone, headline, detail, dangerSide, diagramZone, inWindowToday, placement };
  }, [state]);

  const toggleSkip = (date: string) => {
    if (!state) return;
    const cur = state.config.skip_dates;
    const nextDates = cur.includes(date) ? cur.filter((d) => d !== date) : [...cur, date];
    run(`skip-${date}`, () => setSkipDates(nextDates), cur.includes(date) ? `Alerts back on for ${fmtDay(date)}` : `Skipping ${fmtDay(date)}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Street Sweeping"
        description="Blue Steel on N Kings Rd. Each block has its own days: 700 block (home) west Mon, east Tue; 800 block west Thu, east Fri; 8–10 AM."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}
              className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" disabled={busy !== null}
              onClick={() => run("test", sendTestAlert, "Test alert sent to your phone")}
              className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Send test
            </Button>
          </>
        }
      />

      {error && (
        <div role="alert" className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm text-amber-200 flex items-center justify-between gap-3">
          <span>
            {state ? "Connection dropped. Showing the last update, retrying automatically." : "Couldn't reach the server. Retrying automatically."}
          </span>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}
            className="border-white/10 text-white/70 hover:text-white hover:bg-white/5 shrink-0">
            Retry now
          </Button>
        </div>
      )}

      {!state && !error && (
        <div className="space-y-4" role="status" aria-label="Loading street sweeping status">
          <Skeleton className="h-28 rounded-2xl bg-white/[0.03]" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl bg-white/[0.03]" />)}
          </div>
        </div>
      )}

      {state && derived && (
        <>
          {/* Status */}
          <div className={cn("rounded-2xl border p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4", TONE[derived.tone])}>
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {derived.tone === "danger" ? <AlertTriangle className="h-6 w-6 text-red-300 shrink-0 mt-0.5" />
                : derived.tone === "ok" ? <CheckCircle2 className="h-6 w-6 text-emerald-300 shrink-0 mt-0.5" />
                : derived.tone === "warn" ? <BellOff className="h-6 w-6 text-amber-300 shrink-0 mt-0.5" />
                : <CalendarDays className="h-6 w-6 text-white/55 shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className="text-lg sm:text-xl font-semibold text-white leading-snug">{derived.headline}</p>
                <p className="text-sm text-white/50 mt-1">{derived.detail}</p>
              </div>
            </div>
            {derived.inWindowToday && !state.acked_today && state.config.alerts_enabled && (
              <Button onClick={() => run("ack", acknowledgeToday, "Got it: today's alerts are off")} disabled={busy !== null}
                className="bg-white text-black hover:bg-white/90 shrink-0">
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                I moved it
              </Button>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Car"
              value={CAR_VALUE[derived.placement.status](derived.placement.side)}
              subtitle={derived.placement.ranAt
                ? `${derived.carZone ? `${derived.carZone.name} · ` : ""}${derived.placement.status === "stale" ? `seen ${ago(derived.placement.ranAt)}` : `updated ${ago(derived.placement.ranAt)}`}`
                : "no reading yet"}
              icon={Car}
              tooltip="From the car's own GPS feed (the Tesla worker on the Mac mini), which updates about every 20 min."
            />
            <StatCard
              label="Car's sweep"
              value={derived.carNext ? fmtDay(derived.carNext) : derived.next ? "Not soon" : "None"}
              subtitle={derived.carNext && derived.where ? `${derived.where.side} curb, 8–10 AM` : derived.next ? `next sweep ${fmtDay(derived.next.date)}` : "all skipped"}
              icon={CalendarDays}
            />
            <StatCard
              label="Today"
              value={state.acked_today ? "Handled" : derived.inWindowToday ? "Sweep day" : stopsOn(derived.zones, weekdayOf(derived.today)).length ? "Sweeping over" : "No sweep"}
              subtitle={state.acks[0] ? `last ack ${ago(state.acks[0].acked_at)}` : "no acks yet"}
              icon={CheckCircle2}
            />
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.625rem] sm:text-[0.6875rem] font-medium text-white/55 uppercase tracking-widest">Alerts</p>
                <p className="text-xl sm:text-2xl font-semibold text-white mt-1 leading-none">
                  {state.config.alerts_enabled ? "On" : "Paused"}
                </p>
                <p className="text-[0.625rem] sm:text-xs text-white/50 mt-1">ntfy + Claude push</p>
              </div>
              <Switch
                checked={state.config.alerts_enabled}
                disabled={busy !== null}
                onCheckedChange={(v) => run("enabled", () => setAlertsEnabled(v), v ? "Alerts on" : "Alerts paused")}
                aria-label="Street sweeping alerts"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Street */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-white">Where it's parked</h3>
                  <p className={cn("text-[0.9375rem] font-medium mt-0.5", PLACEMENT_TEXT[derived.placement.status])}>
                    {PLACEMENT_HEADLINE[derived.placement.status](derived.placement.side)}
                  </p>
                </div>
                <span className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem]",
                  derived.placement.fresh
                    ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300"
                    : "border-white/10 bg-white/[0.05] text-white/60",
                )}>
                  {derived.placement.fresh ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <Clock3 className="h-3 w-3" aria-hidden />}
                  {derived.placement.ranAt ? (derived.placement.fresh ? "Current" : `Last check ${ago(derived.placement.ranAt)}`) : "Never checked"}
                </span>
              </div>
              <StreetDiagram status={derived.placement.status} side={derived.placement.side} dangerSide={derived.dangerSide} zone={derived.diagramZone} />
              <p className="text-xs text-white/55 mt-2 text-center">
                {derived.placement.status === "on_sweep_curb" && derived.carNext && derived.carNext !== derived.today
                  ? `Swept ${fmtDay(derived.carNext, { weekday: "long", month: "short", day: "numeric" })}, 8–10\u00a0AM. Move it before 8\u00a0AM that morning or it's a $75 ticket.`
                  : PLACEMENT_DETAIL[derived.placement.status](derived.placement.side, derived.dangerSide, derived.placement.ranAt)}
              </p>
              <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[0.6875rem] text-white/55">
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-red-400/70 border border-red-400/40" aria-hidden />
                  Hatched = swept next{derived.dangerSide ? ` (${derived.dangerSide})` : ""}
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-emerald-400/50 border border-emerald-400/30" aria-hidden />
                  Safe curb
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-3.5 rounded-[3px] bg-white/70" aria-hidden />
                  Blue Steel
                </li>
              </ul>
            </div>

            {/* Skip days */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-white">Upcoming sweep days</h3>
              <p className="text-xs text-white/50 mt-1 mb-4">Tap a day to skip it: a holiday, a trip, or the car's out on a Turo booking.</p>
              <div className="grid grid-cols-2 gap-2">
                {derived.days.map((d) => (
                  <button
                    key={d.date}
                    onClick={() => toggleSkip(d.date)}
                    disabled={busy !== null}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
                      d.skipped
                        ? "border-white/[0.06] bg-transparent text-white/50"
                        : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.07]",
                    )}
                  >
                    <span className={cn("block text-sm font-medium", d.skipped && "line-through")}>{fmtDay(d.date)}</span>
                    <span className="block text-[0.6875rem] text-white/55">
                      {d.skipped ? "skipped" : d.stops.map((t) => `${t.zone.name.replace(" block", "")} ${t.side}`).join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Blocks & calibration */}
          <BlocksCard
            zones={derived.zones}
            carZoneId={derived.carZone?.id ?? null}
            carSide={derived.where?.side ?? null}
            carFresh={derived.placement.fresh}
            busy={busy !== null}
            onCalibrate={(z, side) => run(`cal-${z.id}-${side}`, () => calibrateHere(z.id, side),
              `Saved: the car's spot is the ${side} curb of the ${z.name}`)}
          />

          {/* Log */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-white mb-3">Checks</h3>
              {state.runs.length === 0 ? (
                <p className="text-sm text-white/55 py-6 text-center">No checks yet. They start at 6:55 AM on the next sweep day.</p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {state.runs.map((r) => (
                    <div key={r.id} className="py-2.5 flex flex-wrap sm:flex-nowrap items-start gap-x-3 gap-y-1">
                      <span className="text-xs text-white/55 tabular-nums sm:w-36 shrink-0 pt-0.5">{fmtLA(r.ran_at)}</span>
                      <span className={cn("text-[0.6875rem] px-2 py-0.5 rounded-md border shrink-0", OUTCOME[r.outcome]?.className)}>
                        {OUTCOME[r.outcome]?.label ?? r.outcome}
                      </span>
                      <span className="text-sm text-white/60 min-w-0 break-words basis-full sm:basis-auto">
                        {r.alert_body ?? r.note ?? (r.side ? `${cap(r.side)} curb${derived.zones.find((z) => z.id === r.zone) ? `, ${derived.zones.find((z) => z.id === r.zone)!.name}` : ""}` : "")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-white mb-3">Acknowledgments</h3>
              {state.acks.length === 0 ? (
                <p className="text-sm text-white/55">None yet.</p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {state.acks.map((a) => (
                    <div key={a.id} className="py-2 flex items-center justify-between gap-3">
                      <span className="text-xs text-white/50 tabular-nums">{fmtLA(a.acked_at)}</span>
                      <span className="text-[0.6875rem] text-white/55">{a.via === "tap" ? "tapped alert" : a.via === "button" ? "Moved it button" : a.via === "test-tap" ? "tapped test" : a.via === "test-button" ? "test Moved it button" : a.via}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-white/50">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p>
              The check runs in the database every 5 min, 6:55–10 AM on sweep days, from the car's own GPS feed. If the car is on a
              curb swept that day it sends a critical push (about every 30 min) and shows "Move the car" on the wall and your iPhone.
              When the car leaves, the alert clears itself. Tapping the alert, its "Moved it" button, or "I moved it" here stops that
              morning's alerts. A watchdog tells Scout if the checks stop or the car's position goes stale.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
