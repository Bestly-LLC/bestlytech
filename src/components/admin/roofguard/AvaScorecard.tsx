/**
 * Ava's scorecard: is she earning her keep? Jared's standard from Amazon Business door-to-door is 6 closes a week;
 * for Ava a close = a meeting booked with Eli. Data: rg_ava_kpis() (admin or partner). Used in /admin/roofguard#scorecard,
 * as a one-line strip on the Calls tab, and at the top of the partner portal's Ava sheet.
 *
 * Law of Averages (Jared's Thrive LA packet, weekly target zones): 55 doors -> 30 contacts -> 7 decision makers ->
 * 4.5 presentations -> 2.5 accounts, about 1 close per 22 doors. On the phone the same funnel is
 * dials -> answered -> decision maker -> pitch -> booked. She starts at an assumed 1 meeting per 50 dials (2%) and her
 * real number takes over as calls come in.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AvaReview } from "./AvaReview";
import { AlertTriangle, CheckCircle2, Gauge, PauseCircle, Sprout, TrendingUp, Trophy, CalendarCheck } from "lucide-react";

type Funnel = { dials: number; connects: number; dms: number; pitches: number; booked: number; voicemails?: number; callbacks?: number; not_interested?: number; dnc?: number };
export type Kpis = {
  goal: number; work_days: number; calling: boolean; daily_cap: number; auto_pace: boolean; pilot_limit: number | null;
  week_start: string; today: string; days_left: number; week: Funnel; day: Funnel;
  history: (Funnel & { week: string })[];
  quality: { reply_sec: number | null; avg_call_sec: number | null; optout_rate: number | null; calls_measured: number };
  booked_list: { company: string; dm_name: string | null; dm_title: string | null; meeting_times: string | null; meeting_email: string | null; booked_at: string; state: string }[];
  loa: { rate: number; dials_per_meeting: number; dials_all: number; booked_all: number; prior_rate: number; daily_target: number; weekly_target: number;
    rest_of_week_dials: number; rest_per_day: number | null; door_rate: number; door_dials_per_meeting: number };
  status: "hit" | "on_track" | "behind" | "at_risk" | "off"; projected: number;
  hire: "ramping" | "retained" | "watch" | "probation"; live_weeks: number; last2_avg: number | null; leads_left: number; max_attempts: number;
};

export function useKpis(poll = 60000) {
  const [k, setK] = useState<Kpis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await (supabase.rpc as unknown as (f: string, a: object) => Promise<{ data: Kpis | null; error: { message: string } | null }>)("rg_ava_kpis", { p_weeks: 8 });
    if (error) { setErr(error.message); return; }
    setErr(null); setK(data);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, poll); return () => clearInterval(t); }, [load, poll]);
  return { k, err, reload: load };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : null);
const STATUS: Record<Kpis["status"], { text: string; cls: string; Icon: typeof CheckCircle2 }> = {
  hit: { text: "Goal hit", cls: "bg-emerald-500/15 text-emerald-300", Icon: Trophy },
  on_track: { text: "On track", cls: "bg-emerald-500/15 text-emerald-300", Icon: CheckCircle2 },
  behind: { text: "Behind pace", cls: "bg-amber-500/15 text-amber-300", Icon: TrendingUp },
  at_risk: { text: "At risk", cls: "bg-rose-500/15 text-rose-300", Icon: AlertTriangle },
  off: { text: "Calling paused", cls: "bg-white/10 text-white/65", Icon: PauseCircle },
};
const HIRE: Record<Kpis["hire"], { text: string; sub: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ramping: { text: "Ramping", sub: "Needs 2 full weeks of calling before review", cls: "bg-sky-500/15 text-sky-300", Icon: Sprout },
  retained: { text: "Retained", sub: "Averaging the goal over her last 2 weeks", cls: "bg-emerald-500/15 text-emerald-300", Icon: CheckCircle2 },
  watch: { text: "Watch", sub: "2/3 of the goal or better: tune the script", cls: "bg-amber-500/15 text-amber-300", Icon: Gauge },
  probation: { text: "Probation", sub: "Under 2/3 of the goal for 2 weeks running", cls: "bg-rose-500/15 text-rose-300", Icon: AlertTriangle },
};
function Pill({ cls, Icon, children }: { cls: string; Icon: typeof CheckCircle2; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", cls)}><Icon className="h-3.5 w-3.5" aria-hidden />{children}</span>;
}

/** booked vs goal: a hero number with a thin ring */
function Ring({ value, goal }: { value: number; goal: number }) {
  const r = 44, c = 2 * Math.PI * r, f = Math.min(1, goal ? value / goal : 0);
  return (
    <div className="relative h-28 w-28 shrink-0" role="img" aria-label={`${value} of ${goal} meetings booked this week`}>
      <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-white/10" />
        <circle cx="56" cy="56" r={r} fill="none" strokeWidth="8" strokeLinecap="round" stroke="#34d399"
          strokeDasharray={`${c * f} ${c}`} className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-500" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><div className="text-[1.875rem] font-semibold leading-none tabular-nums text-white">{value}</div>
          <div className="mt-1 text-xs text-white/55">of {goal}</div></div>
      </div>
    </div>
  );
}

function Bar({ value, max, tone = "#34d399", label }: { value: number; max: number; tone?: string; label: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${Math.min(100, max ? (100 * value) / max : 0)}%`, background: tone }} />
    </div>
  );
}

/** One-line version for the top of the Calls tab */
export function AvaScoreStrip({ onOpen }: { onOpen?: () => void }) {
  const { k } = useKpis();
  if (!k) return null;
  const s = STATUS[k.status];
  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-white/[0.03] px-4 py-3 text-left ring-1 ring-white/10 transition hover:bg-white/[0.05]">
      <span className="text-sm text-white/60">This week</span>
      <span className="text-[0.9375rem] font-semibold tabular-nums text-white">{k.week.booked}<span className="text-white/60"> / {k.goal} booked</span></span>
      <span className="text-sm text-white/60">Today <span className="tabular-nums text-white">{k.day.dials}</span><span className="text-white/60"> / {k.loa.daily_target} dials</span></span>
      <span className="ml-auto"><Pill cls={s.cls} Icon={s.Icon}>{s.text}</Pill></span>
    </button>
  );
}

export function AvaScorecard({ admin = false, narrow = false, data }: { admin?: boolean; narrow?: boolean; data?: Kpis }) {
  const live = useKpis();
  const k = data ?? live.k, err = data ? null : live.err, reload = live.reload;
  const [saving, setSaving] = useState(false);
  if (err) return <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load Ava's scorecard: {err}</div>;
  if (!k) return <div className="h-48 animate-pulse rounded-3xl bg-white/[0.03] ring-1 ring-white/10" aria-label="Loading scorecard" />;

  const st = STATUS[k.status], hire = HIRE[k.hire];
  const w = k.week;
  const steps: { label: string; n: number; door: number }[] = [
    { label: "Dials", n: w.dials, door: 55 }, { label: "Answered", n: w.connects, door: 30 }, { label: "Decision makers", n: w.dms, door: 7 },
    { label: "Pitches", n: w.pitches, door: 4.5 }, { label: "Booked", n: w.booked, door: 2.5 },
  ];
  const histMax = Math.max(k.goal, ...k.history.map((h) => h.booked), 1);
  const runwayWeeks = k.loa.daily_target > 0 ? Math.floor((k.leads_left * k.max_attempts) / (k.loa.daily_target * k.work_days)) : null;
  const measured = k.loa.dials_all >= 100;

  const toggleAuto = async () => {
    setSaving(true);
    await (supabase.from("rg_settings" as never) as unknown as { update: (p: object) => { eq: (c: string, v: boolean) => Promise<unknown> } })
      .update({ auto_pace: !k.auto_pace, updated_at: new Date().toISOString(), updated_by: "admin" }).eq("id", true);
    setSaving(false); void reload();
  };

  return (
    <div className="space-y-4">
      {/* headline */}
      <section className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10" aria-label="This week">
        <div className="flex flex-wrap items-center gap-5">
          <Ring value={w.booked} goal={k.goal} />
          <div className="min-w-[220px] flex-1 space-y-3">
            <div>
              <div className="text-[0.8125rem] text-white/55">Meetings booked with Eli this week</div>
              <div className="mt-1 flex flex-wrap gap-2"><Pill cls={st.cls} Icon={st.Icon}>{st.text}</Pill><Pill cls={hire.cls} Icon={hire.Icon}>Hire status: {hire.text}</Pill></div>
              <p className="mt-1.5 text-xs text-white/60">{hire.sub}.</p>
            </div>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between text-[0.8125rem]">
                <span className="text-white/70">Dials today</span>
                <span className="tabular-nums text-white">{k.day.dials}<span className="text-white/60"> / {k.loa.daily_target}</span></span>
              </div>
              <Bar value={k.day.dials} max={k.loa.daily_target} label="Dials today versus daily target" />
            </div>
          </div>
        </div>
      </section>

      {/* the math */}
      <section className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10" aria-label="The Law of Averages">
        <h3 className="text-[0.9375rem] font-semibold text-white">The Law of Averages</h3>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-white/80">
          Goal: <b className="text-white">{k.goal} meetings a week</b> ({k.goal} closes, your Amazon Business standard).
          {" "}{measured ? "Her real average" : "Starting assumption"}: <b className="text-white">1 meeting per {k.loa.dials_per_meeting} dials</b>.
          {" "}So she needs <b className="text-white">{k.loa.weekly_target} dials a week</b>, about <b className="text-white">{k.loa.daily_target} a day</b> over {k.work_days} days.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-white/60">
          Your door-to-door LOA was about 1 close per {k.loa.door_dials_per_meeting} doors (55 doors, 30 contacts, 7 decision makers, 4.5 pitches, 2.5 accounts a week). Cold calls convert worse than walking in, so Ava starts at 1 per 50.
          {measured ? ` This number is now hers: ${k.loa.booked_all} booked from ${k.loa.dials_all} real dials.` : ` Her own number replaces it as real calls come in (${k.loa.dials_all} so far).`}
        </p>
        {k.status !== "hit" && k.days_left > 0 && k.loa.rest_per_day != null && (
          <p className="mt-3 rounded-xl bg-white/[0.04] px-3 py-2 text-sm text-white/80">
            To still hit {k.goal} this week: <b className="text-white tabular-nums">{k.loa.rest_of_week_dials}</b> more dials over {k.days_left} day{k.days_left === 1 ? "" : "s"} (<span className="whitespace-nowrap tabular-nums">{k.loa.rest_per_day} a day</span>).
          </p>
        )}
      </section>

      <div className={cn("grid gap-4", !narrow && "lg:grid-cols-2")}>
        {/* funnel */}
        <section className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10" aria-label="This week's funnel">
          <h3 className="mb-3 text-[0.9375rem] font-semibold text-white">This week, step by step</h3>
          <ol className="space-y-3">
            {steps.map((s, i) => {
              const conv = i > 0 ? pct(s.n, steps[i - 1].n) : null;
              const doorConv = i > 0 ? Math.round((100 * s.door) / steps[i - 1].door) : null;
              return (
                <li key={s.label}>
                  <div className="mb-1 flex items-baseline gap-2 text-[0.8125rem]">
                    <span className="text-white/75">{s.label}</span>
                    <span className="ml-auto tabular-nums text-white">{s.n.toLocaleString()}</span>
                    <span className="min-w-[7rem] whitespace-nowrap text-right text-xs tabular-nums text-white/60">{i === 0 ? "" : conv == null ? "–" : `${conv}%`}{i > 0 && <span className="text-white/60"> · door {doorConv}%</span>}</span>
                  </div>
                  <Bar value={s.n} max={Math.max(steps[0].n, 1)} label={`${s.label}: ${s.n}`} tone={i === steps.length - 1 ? "#34d399" : "#7dd3fc"} />
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[0.75rem] text-white/55">Percent = share of the step above. "Door" = your Amazon Business rate at that step.</p>
        </section>

        {/* history */}
        <section className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10" aria-label="Meetings booked per week">
          <h3 className="mb-3 text-[0.9375rem] font-semibold text-white">Booked per week</h3>
          <div className="relative flex h-36 items-end gap-[2px]" role="img" aria-label={`Last ${k.history.length} weeks of meetings booked, goal ${k.goal}`}>
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/30" style={{ bottom: `${(100 * k.goal) / histMax}%` }} aria-hidden>
              <span className="absolute -top-4 right-0 text-[0.6875rem] text-white/60">goal {k.goal}</span>
            </div>
            {k.history.map((h) => (
              <div key={h.week} className="group relative flex h-full flex-1 items-end justify-center" title={`Week of ${new Date(h.week + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}: ${h.booked} booked, ${h.dials} dials`}>
                <div className="w-full max-w-[28px] rounded-t-[4px] bg-emerald-400/90 group-hover:bg-emerald-300" style={{ height: `${Math.max(h.booked ? 4 : 0, (100 * h.booked) / histMax)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-[2px] text-[0.6875rem] text-white/55">
            {k.history.map((h) => <span key={h.week} className="flex-1 text-center">{new Date(h.week + "T12:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}</span>)}
          </div>
          <table className="sr-only"><caption>Meetings booked per week</caption><thead><tr><th>Week of</th><th>Dials</th><th>Booked</th></tr></thead>
            <tbody>{k.history.map((h) => <tr key={h.week}><td>{h.week}</td><td>{h.dials}</td><td>{h.booked}</td></tr>)}</tbody></table>
        </section>
      </div>

      <div className={cn("grid gap-4", !narrow && "lg:grid-cols-2")}>
        {/* quality */}
        <section className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10" aria-label="Call quality">
          <h3 className="mb-3 text-[0.9375rem] font-semibold text-white">Call quality</h3>
          <dl className="grid grid-cols-3 gap-3">
            <div><dt className="text-xs text-white/60">Reply speed</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-white">{k.quality.reply_sec != null ? <>{k.quality.reply_sec}<span className="text-sm text-white/60">&nbsp;sec</span></> : "–"}</dd><dd className="text-[0.75rem] text-white/55">goal: 1&nbsp;sec or less</dd></div>
            <div><dt className="text-xs text-white/60">Avg call</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-white">{k.quality.avg_call_sec != null ? <>{Math.floor(k.quality.avg_call_sec / 60)}:{String(k.quality.avg_call_sec % 60).padStart(2, "0")}</> : "–"}</dd><dd className="text-[0.75rem] text-white/55">answered calls</dd></div>
            <div><dt className="text-xs text-white/60">Opt-outs</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-white">{k.quality.optout_rate != null ? <>{k.quality.optout_rate}<span className="text-sm text-white/60">%</span></> : "–"}</dd><dd className="text-[0.75rem] text-white/55">of answered, 28&nbsp;days</dd></div>
          </dl>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/5 pt-3 text-xs text-white/55">
            <span className="whitespace-nowrap">Voicemails <b className="tabular-nums text-white">{w.voicemails ?? 0}</b></span>
            <span className="whitespace-nowrap">Callbacks <b className="tabular-nums text-white">{w.callbacks ?? 0}</b></span>
            <span className="whitespace-nowrap">Not interested <b className="tabular-nums text-white">{w.not_interested ?? 0}</b></span>
          </div>
        </section>

        {/* booked meetings */}
        <section className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10" aria-label="Meetings booked">
          <h3 className="mb-3 flex items-center gap-2 text-[0.9375rem] font-semibold text-white"><CalendarCheck className="h-4 w-4 text-emerald-300" aria-hidden />Meetings for Eli</h3>
          {k.booked_list.length === 0 ? <p className="text-sm text-white/60">None yet. They land here the moment Ava books one.</p> : (
            <ul className="divide-y divide-white/5">
              {k.booked_list.map((b, i) => (
                <li key={i} className="py-2">
                  <div className="flex items-baseline gap-2"><span className="text-[0.9375rem] font-medium text-white">{b.company}</span><span className="text-xs text-white/60">{b.state}</span></div>
                  <div className="text-xs text-white/60">{[b.dm_name && `${b.dm_name}${b.dm_title ? `, ${b.dm_title}` : ""}`, b.meeting_times, b.meeting_email].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* runway + pace control */}
      <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10" aria-label="Runway">
        <div className="min-w-[200px] flex-1 text-sm text-white/70">
          <b className="text-white tabular-nums">{k.leads_left.toLocaleString()}</b> leads left with up to {k.max_attempts} tries each.
          {runwayWeeks != null && <> At {k.loa.daily_target} dials a day that's about <b className="whitespace-nowrap text-white tabular-nums">{runwayWeeks} weeks</b> of calling.</>}
          <div className="mt-1 text-xs text-white/60">Today's cap: <span className="tabular-nums">{k.daily_cap}</span> calls{k.pilot_limit ? ` · pilot: ${k.pilot_limit} leads` : ""}.</div>
        </div>
        {admin && (
          <label className="flex cursor-pointer items-center gap-3 text-sm text-white/80">
            <span className="max-w-[260px] text-right text-xs text-white/55">Auto-pace: each weekday morning, set her call cap to the daily target (after the pilot)</span>
            <button type="button" role="switch" aria-checked={k.auto_pace} disabled={saving} onClick={() => void toggleAuto()}
              className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors", k.auto_pace ? "bg-[#30D158]" : "bg-white/20")}>
              <span className={cn("absolute left-0 top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform", k.auto_pace ? "translate-x-[22px]" : "translate-x-[2px]")} />
            </button>
          </label>
        )}
      </section>

      {admin && <AvaReview />}
    </div>
  );
}
