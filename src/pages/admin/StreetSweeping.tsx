import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function StreetDiagram({ carSide, dangerSide }: { carSide: CurbSide | null; dangerSide: CurbSide | null }) {
  // Top-down view of N Kings Rd (north is up). The car snaps to whichever curb it's parked on:
  // far left = west curb (swept Mondays), far right = east curb (swept Tuesdays).
  const W = 240;
  const H = 108;
  const road = { x: 60, y: 6, w: 120, h: 96 };
  const mid = road.x + road.w / 2;
  const car = { w: 20, h: 38 };
  const carX = carSide === "west" ? road.x + 5 : carSide === "east" ? road.x + road.w - 5 - car.w : null;
  const carY = road.y + (road.h - car.h) / 2;
  const danger = carSide !== null && carSide === dangerSide;
  const laneTint = (side: CurbSide) => (dangerSide === side ? "rgba(248,113,113,0.14)" : "transparent");
  const label = (side: CurbSide) => {
    const x = side === "west" ? road.x - 10 : road.x + road.w + 10;
    const anchor = side === "west" ? "end" : "start";
    const hot = dangerSide === side;
    return (
      <g>
        <text x={x} y={H / 2 - 4} textAnchor={anchor} fontSize="11" fontWeight={500} fill="rgba(255,255,255,0.75)">
          {side === "west" ? "West" : "East"}
        </text>
        <text x={x} y={H / 2 + 11} textAnchor={anchor} fontSize="10" fill={hot ? "#fca5a5" : "rgba(255,255,255,0.4)"}>
          {side === "west" ? "Mon" : "Tue"} 8–10
        </text>
      </g>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-[18.75rem] h-auto mx-auto block"
      role="img"
      aria-label={
        carSide
          ? `Blue Steel is parked on the ${carSide} curb of North Kings Road${danger ? ", the next side to be swept" : ""}`
          : "Blue Steel isn't parked on this block"
      }
    >
      {/* road + lane tints, clipped to one rounded shape so the lanes meet cleanly at the center line */}
      <defs>
        <clipPath id="kings-road">
          <rect x={road.x} y={road.y} width={road.w} height={road.h} rx={6} />
        </clipPath>
      </defs>
      <g clipPath="url(#kings-road)">
        <rect x={road.x} y={road.y} width={road.w} height={road.h} fill="rgba(255,255,255,0.05)" />
        <rect x={road.x} y={road.y} width={road.w / 2} height={road.h} fill={laneTint("west")} />
        <rect x={mid} y={road.y} width={road.w / 2} height={road.h} fill={laneTint("east")} />
      </g>
      {/* curbs */}
      <line x1={road.x} y1={road.y} x2={road.x} y2={road.y + road.h} stroke="rgba(255,255,255,0.35)" strokeWidth={2} strokeLinecap="round" />
      <line x1={road.x + road.w} y1={road.y} x2={road.x + road.w} y2={road.y + road.h} stroke="rgba(255,255,255,0.35)" strokeWidth={2} strokeLinecap="round" />
      {/* center line */}
      <line x1={mid} y1={road.y + 6} x2={mid} y2={road.y + road.h - 6} stroke="rgba(250,204,21,0.45)" strokeWidth={1.5} strokeDasharray="7 6" />
      {label("west")}
      {label("east")}
      {carX !== null ? (
        <g>
          <rect x={carX} y={carY} width={car.w} height={car.h} rx={6} fill={danger ? "#f87171" : "#818cf8"} />
          <rect x={carX + 3} y={carY + 6} width={car.w - 6} height={8} rx={2} fill="rgba(0,0,0,0.35)" />
          <rect x={carX + 3} y={carY + car.h - 11} width={car.w - 6} height={6} rx={2} fill="rgba(0,0,0,0.25)" />
        </g>
      ) : (
        <text x={mid} y={H / 2 + 4} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.4)">Not on block</text>
      )}
    </svg>
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
    // Checks run every 30 min from 6:55am. Past 7:05 with nothing logged in 40 min, they've stopped.
    const lastCheck = state.runs.find((r) => r.outcome !== "test") ?? null;
    const checksMissing = inWindowToday && nowMin >= 425
      && (!lastCheck || Date.now() - new Date(lastCheck.ran_at).getTime() > 40 * 60_000);

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
      detail = `${cap(todaySide!)} curb is swept today, 8–10am. `
        + (latestToday
          ? `Last check ${fmtLA(latestToday.ran_at, { hour: "numeric", minute: "2-digit" })}${latestToday.side ? ` saw it on the ${latestToday.side} curb` : ""}.`
          : "Nothing has checked the car this morning.");
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
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-white">Where it's parked</h3>
                {derived.car && (
                  <span className="text-xs text-white/50">{fmtLA(derived.car.ran_at)}</span>
                )}
              </div>
              <StreetDiagram carSide={derived.car?.side ?? null} dangerSide={derived.dangerSide} />
              <p className="text-xs text-white/55 mt-3 text-center">
                Red = next curb swept. {derived.car?.side ? `Parked on the ${derived.car.side} curb.` : ""}
              </p>
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
                    <span className="block text-[0.6875rem] text-white/55">{d.skipped ? "skipped" : `${d.side} curb`}</span>
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
                <p className="text-sm text-white/55 py-6 text-center">No checks yet. The first runs Monday at 6:55am.</p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {state.runs.map((r) => (
                    <div key={r.id} className="py-2.5 flex flex-wrap sm:flex-nowrap items-start gap-x-3 gap-y-1">
                      <span className="text-xs text-white/55 tabular-nums sm:w-36 shrink-0 pt-0.5">{fmtLA(r.ran_at)}</span>
                      <span className={cn("text-[0.6875rem] px-2 py-0.5 rounded-md border shrink-0", OUTCOME[r.outcome]?.className)}>
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
              Checks run as two Claude scheduled tasks every 30 min, 6:55–9:55am on sweep days, reading the car from TezLab.
              Alerts go to ntfy at top priority. Tapping the alert, its "Moved it" button, or "I moved it" here stops that morning's alerts.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
