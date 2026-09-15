import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Car, CalendarDays, BellRing, CheckCircle2, RefreshCw, Send, AlertTriangle, BellOff, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { pollInterval } from "@/lib/polling";
import {
  SweepState,
  SweepOutcome,
  CurbSide,
  fetchSweepState,
  setAlertsEnabled,
  setSkipDates,
  acknowledgeToday,
  sendTestAlert,
  upcomingSweepDays,
  weekdayOf,
  SWEEP_DAYS,
  laNowMinutes,
  fmtDay,
  fmtLA,
  ago,
  STREET_BOUNDS,
  SIDE_SPLIT_LON,
} from "@/services/streetSweepingApi";

const OUTCOME: Record<SweepOutcome, { label: string; className: string }> = {
  alerted: { label: "Alert sent", className: "bg-red-500/10 text-red-300 border-red-500/20" },
  safe_side: { label: "Safe side", className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  not_on_street: { label: "Not on Kings", className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  acknowledged: { label: "Acknowledged", className: "bg-white/[0.06] text-white/60 border-white/10" },
  disabled: { label: "Paused", className: "bg-white/[0.06] text-white/50 border-white/10" },
  skipped: { label: "Skipped day", className: "bg-white/[0.06] text-white/50 border-white/10" },
  location_error: { label: "No location", className: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  outside_window: { label: "Outside window", className: "bg-white/[0.06] text-white/40 border-white/10" },
  test: { label: "Test", className: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20" },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayName = (side: CurbSide) => (side === "west" ? "Monday" : "Tuesday");
const laDateOf = (ts: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

type Tone = "danger" | "ok" | "warn" | "neutral";
const TONE: Record<Tone, string> = {
  danger: "border-red-500/30 bg-red-500/[0.07]",
  ok: "border-emerald-500/25 bg-emerald-500/[0.06]",
  warn: "border-amber-500/25 bg-amber-500/[0.06]",
  neutral: "border-white/[0.06] bg-white/[0.03]",
};

function StreetDiagram({ carLon, carSide, dangerSide }: { carLon: number | null; carSide: CurbSide | null; dangerSide: CurbSide | null }) {
  // West on the left, east on the right. The car dot is placed by longitude within the street bounds.
  const W = 320;
  const H = 150;
  const streetX = 92;
  const streetW = 136;
  let carX: number | null = null;
  if (carLon !== null && carLon >= STREET_BOUNDS.lonMin && carLon <= STREET_BOUNDS.lonMax) {
    const t = (carLon - STREET_BOUNDS.lonMin) / (STREET_BOUNDS.lonMax - STREET_BOUNDS.lonMin);
    carX = streetX + 14 + t * (streetW - 28);
  }
  const splitT = (SIDE_SPLIT_LON - STREET_BOUNDS.lonMin) / (STREET_BOUNDS.lonMax - STREET_BOUNDS.lonMin);
  const splitX = streetX + 14 + splitT * (streetW - 28);
  const laneFill = (side: CurbSide) => (dangerSide === side ? "rgba(248,113,113,0.16)" : "rgba(255,255,255,0.03)");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="North Kings Road with the car's curb position">
      {/* sidewalks */}
      <rect x={streetX - 16} y={4} width={16} height={H - 18} rx={3} fill="rgba(255,255,255,0.06)" />
      <rect x={streetX + streetW} y={4} width={16} height={H - 18} rx={3} fill="rgba(255,255,255,0.06)" />
      {/* lanes */}
      <rect x={streetX} y={4} width={splitX - streetX} height={H - 18} fill={laneFill("west")} />
      <rect x={splitX} y={4} width={streetX + streetW - splitX} height={H - 18} fill={laneFill("east")} />
      <line x1={splitX} y1={10} x2={splitX} y2={H - 20} stroke="rgba(255,255,255,0.18)" strokeDasharray="6 6" />
      {/* labels */}
      <text x={streetX - 22} y={H / 2 - 10} textAnchor="end" fontSize="12" fill="rgba(255,255,255,0.7)">West curb</text>
      <text x={streetX - 22} y={H / 2 + 6} textAnchor="end" fontSize="11" fill={dangerSide === "west" ? "#fca5a5" : "rgba(255,255,255,0.35)"}>Swept Mon</text>
      <text x={streetX + streetW + 22} y={H / 2 - 10} fontSize="12" fill="rgba(255,255,255,0.7)">East curb</text>
      <text x={streetX + streetW + 22} y={H / 2 + 6} fontSize="11" fill={dangerSide === "east" ? "#fca5a5" : "rgba(255,255,255,0.35)"}>Swept Tue</text>
      <text x={streetX + streetW / 2} y={H - 2} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.3)" letterSpacing="1.5">N KINGS RD · NORTH ↑</text>
      {/* car */}
      {carX !== null ? (
        <g>
          <rect x={carX - 11} y={H / 2 - 27} width={22} height={40} rx={6}
            fill={carSide && carSide === dangerSide ? "#f87171" : "#818cf8"} />
          <rect x={carX - 7} y={H / 2 - 19} width={14} height={9} rx={2} fill="rgba(0,0,0,0.35)" />
        </g>
      ) : (
        <text x={streetX + streetW / 2} y={H / 2 + 4} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.35)">
          Car not on this block
        </text>
      )}
    </svg>
  );
}

export default function StreetSweeping() {
  const [state, setState] = useState<SweepState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await fetchSweepState());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, pollInterval(60_000));
    return () => clearInterval(iv);
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error((e as Error).message || "That didn't go through");
    } finally {
      setBusy(null);
    }
  };

  const derived = useMemo(() => {
    if (!state) return null;
    const today = state.la_today;
    const todaySide = SWEEP_DAYS[weekdayOf(today)] ?? null;
    const nowMin = laNowMinutes();
    const days = upcomingSweepDays(today, state.config.skip_dates, 6);
    const next = days.find((d) => !d.skipped) ?? null;
    const car = state.last_location;
    const todaysChecks = state.runs.filter(
      (r) => laDateOf(r.ran_at) === today && ["alerted", "safe_side", "not_on_street", "location_error"].includes(r.outcome),
    );
    const latestToday = todaysChecks[0] ?? null;
    const inWindowToday = !!todaySide && nowMin < 600 && !state.config.skip_dates.includes(today);

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
    } else if (inWindowToday && latestToday?.outcome === "alerted") {
      tone = "danger";
      headline = `Move Blue Steel: it's on the ${latestToday.side} curb`;
      detail = nowMin < 480 ? "Sweeping starts at 8am. $75 ticket." : "Sweeping until 10am. $75 ticket.";
    } else if (inWindowToday && latestToday?.outcome === "location_error") {
      tone = "warn";
      headline = "Couldn't read the car's location";
      detail = `Check it yourself: ${cap(todaySide!)} curb is swept today, 8–10am.`;
    } else if (inWindowToday && latestToday) {
      tone = "ok";
      headline = latestToday.outcome === "safe_side" ? "Blue Steel is on the safe side" : "Blue Steel isn't parked on Kings Rd";
      detail = `Last checked ${fmtLA(latestToday.ran_at, { hour: "numeric", minute: "2-digit" })}. Checks continue every 30 min until 9:55am.`;
    } else if (inWindowToday) {
      headline = `${cap(todaySide!)} curb is swept today, 8–10am`;
      detail = nowMin < 415 ? "First check at 6:55am." : "Waiting on the next check.";
    } else if (next) {
      const carOnNextSide = car?.side && car.side === next.side;
      tone = carOnNextSide ? "warn" : "neutral";
      headline = `Next sweep ${fmtDay(next.date, { weekday: "long", month: "short", day: "numeric" })}: ${next.side} curb`;
      detail = carOnNextSide
        ? `The car was last seen on the ${next.side} curb (${ago(car!.ran_at)}). Alerts start 6:55am if it's still there.`
        : "Alerts start at 6:55am that morning if the car is on that curb.";
    } else {
      headline = "No sweep days in the next few weeks";
      detail = "Every upcoming sweep day is marked to skip.";
    }

    const dangerSide: CurbSide | null = inWindowToday ? todaySide : next?.side ?? null;
    return { today, todaySide, days, next, car, tone, headline, detail, dangerSide, inWindowToday };
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
        description="Blue Steel on N Kings Rd. West curb Mondays, east curb Tuesdays, 8–10am."
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
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-300">
          Couldn't load sweeping status: {error}
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
                : <CalendarDays className="h-6 w-6 text-white/40 shrink-0 mt-0.5" />}
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
              value={derived.car?.side ? `${cap(derived.car.side)} curb` : derived.car ? "Off Kings" : "Unknown"}
              subtitle={derived.car ? `seen ${ago(derived.car.ran_at)}` : "no reading yet"}
              icon={Car}
              tooltip="Last reading from a sweeping check. The car isn't polled between checks."
            />
            <StatCard
              label="Next sweep"
              value={derived.next ? fmtDay(derived.next.date) : "None"}
              subtitle={derived.next ? `${derived.next.side} curb, 8–10am` : "all skipped"}
              icon={CalendarDays}
            />
            <StatCard
              label="Today"
              value={state.acked_today ? "Handled" : derived.todaySide ? "Sweep day" : "No sweep"}
              subtitle={state.acks[0] ? `last ack ${ago(state.acks[0].acked_at)}` : "no acks yet"}
              icon={CheckCircle2}
            />
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] sm:text-[11px] font-medium text-white/40 uppercase tracking-widest">Alerts</p>
                <p className="text-xl sm:text-2xl font-semibold text-white mt-1 leading-none">
                  {state.config.alerts_enabled ? "On" : "Paused"}
                </p>
                <p className="text-[10px] sm:text-xs text-white/25 mt-1">ntfy + Claude push</p>
              </div>
              <Switch
                checked={state.config.alerts_enabled}
                disabled={busy !== null}
                onCheckedChange={(v) => run("enabled", () => setAlertsEnabled(v), v ? "Alerts on" : "Alerts paused")}
                aria-label="Street sweeping alerts"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Street */}
            <div className="lg:col-span-3 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-white">Where it's parked</h3>
                {derived.car && (
                  <span className="text-xs text-white/30">{fmtLA(derived.car.ran_at)}</span>
                )}
              </div>
              <StreetDiagram
                carLon={derived.car?.longitude ?? null}
                carSide={derived.car?.side ?? null}
                dangerSide={derived.dangerSide}
              />
              <p className="text-xs text-white/30 mt-2">
                Red lane = the next curb to be swept. Side is read from GPS longitude; the two curb lanes sit about 30 ft apart.
              </p>
            </div>

            {/* Skip days */}
            <div className="lg:col-span-2 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-white">Upcoming sweep days</h3>
              <p className="text-xs text-white/35 mt-1 mb-4">Tap a day to skip it: a holiday, a trip, or the car's out on a Turo booking.</p>
              <div className="grid grid-cols-2 gap-2">
                {derived.days.map((d) => (
                  <button
                    key={d.date}
                    onClick={() => toggleSkip(d.date)}
                    disabled={busy !== null}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
                      d.skipped
                        ? "border-white/[0.06] bg-transparent text-white/30"
                        : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.07]",
                    )}
                  >
                    <span className={cn("block text-sm font-medium", d.skipped && "line-through")}>{fmtDay(d.date)}</span>
                    <span className="block text-[11px] text-white/40">{d.skipped ? "skipped" : `${d.side} curb`}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Log */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-white mb-3">Checks</h3>
              {state.runs.length === 0 ? (
                <p className="text-sm text-white/40 py-6 text-center">No checks yet. The first runs Monday at 6:55am.</p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {state.runs.map((r) => (
                    <div key={r.id} className="py-2.5 flex flex-wrap sm:flex-nowrap items-start gap-x-3 gap-y-1">
                      <span className="text-xs text-white/40 tabular-nums sm:w-36 shrink-0 pt-0.5">{fmtLA(r.ran_at)}</span>
                      <span className={cn("text-[11px] px-2 py-0.5 rounded-md border shrink-0", OUTCOME[r.outcome]?.className)}>
                        {OUTCOME[r.outcome]?.label ?? r.outcome}
                      </span>
                      <span className="text-sm text-white/60 min-w-0 break-words basis-full sm:basis-auto">
                        {r.alert_body ?? r.note ?? (r.side ? `${cap(r.side)} curb` : "")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-6">
              <h3 className="text-sm font-semibold text-white mb-3">Acknowledgments</h3>
              {state.acks.length === 0 ? (
                <p className="text-sm text-white/40">None yet.</p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {state.acks.map((a) => (
                    <div key={a.id} className="py-2 flex items-center justify-between gap-3">
                      <span className="text-xs text-white/50 tabular-nums">{fmtLA(a.acked_at)}</span>
                      <span className="text-[11px] text-white/40">{a.via === "tap" ? "tapped alert" : a.via === "button" ? "Moved it button" : a.via}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-white/30">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p>
              Checks run as two Claude scheduled tasks every 30 min, 6:55–9:55am on sweep days, reading the car from TezLab.
              Alerts go to ntfy at top priority. Tapping the alert, its "Moved it" button, or "I moved it" here stops that morning's alerts.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
