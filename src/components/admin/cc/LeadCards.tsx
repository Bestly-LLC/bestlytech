/**
 * The four lead cards (Money / Turo / AI team / My day): one answer each, readable at a glance on a phone,
 * tap to open the detail: in a side sheet on a phone, and on lg and up by scrolling to its always-visible panel (see Details.tsx). Each card says how fresh it is in its own footer ("Updated 8:05 PM", or
 * "Updated 3 hours ago" once behind) and degrades on its own: a failing source never blanks the page.
 */
import { useState, type ReactNode } from "react";
import { Bot, CalendarClock, ChevronRight, Landmark, CarFront } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { LoadError, Pill, cardCls, focusRing } from "@/components/admin/ui";
import { SheetDetail, jumpToPanel, nowrap, useLineup, type Meetings } from "@/components/admin/cc/Details";
import { upcoming } from "@/components/admin/cc/homeLogic";
import {
  glue,
  monthDay, rainPeak, stamp, time12, usd, whenShort, type CcBundle, type Live, type Wx, type WxEventsPayload,
} from "@/lib/commandCenter";

type Open = null | "money" | "turo" | "ai" | "myday";

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const k = (d: Date) => new Date(d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })).getTime();
  return Math.round((k(new Date(iso)) - k(new Date())) / 864e5);
}
const inDays = (n: number | null) => (n == null ? "" : n <= 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);

/* ───────── one card ───────── */

function LeadCard({ id, icon: Icon, label, big, sub, chip, foot, onOpen, state, wide }: {
  id: string; icon: typeof Landmark; label: string; big: ReactNode; sub: ReactNode; chip?: ReactNode;
  foot: { text: string; stale: boolean } | null; onOpen: () => void; state: "ok" | "loading" | "error"; wide: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup={wide ? undefined : "dialog"}
      aria-controls={wide ? `cc-panel-${id}` : undefined}
      aria-label={wide ? `${label}. Go to details.` : `${label}. Open details.`}
      data-testid={`lead-${id}`}
      className={cn(cardCls, "group flex min-h-[44px] w-full flex-col gap-1.5 p-4 text-left transition active:scale-[0.985] hover:bg-white/[0.05] motion-reduce:transition-none motion-reduce:active:scale-100 sm:p-5", focusRing)}
    >
      <span className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.02em] text-white/60">
        <Icon className="h-4 w-4" aria-hidden />
        {label}
        <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal">{chip}<ChevronRight className="h-4 w-4 text-white/35 transition-colors group-hover:text-white/70" aria-hidden /></span>
      </span>
      {state === "loading" ? (
        <span className="space-y-2" aria-hidden><span className="block h-8 w-1/2 animate-pulse rounded bg-white/[0.06]" /><span className="block h-4 w-4/5 animate-pulse rounded bg-white/[0.04]" /></span>
      ) : (
        <>
          <span className="text-[28px] font-semibold leading-tight tracking-tight text-white" data-testid={`lead-${id}-answer`}>{big}</span>
          <span className="text-[14px] leading-snug text-white/70">{sub}</span>
        </>
      )}
      {foot && (
        <span className={cn("mt-auto pt-1 text-[12px] tabular-nums", foot.stale ? "text-[#FF9F0A] bento:text-[#C93400]" : "text-white/45")} data-testid={`lead-${id}-foot`}>
          {foot.text}
        </span>
      )}
    </button>
  );
}

/* ───────── cards + sheets ───────── */

export function LeadCards({ cc, wx, evs, needs, stuck, meetings, wide }: {
  cc: Live<CcBundle>; wx: Wx | undefined; evs: WxEventsPayload | undefined; needs: number | null; stuck: number | null; meetings: Meetings; wide: boolean;
}) {
  const [open, setOpen] = useState<Open>(null);
  /** lg and up: the panel is already on the page, so go to it. Phone: open it in the sheet. */
  const openIt = (id: Exclude<Open, null>) => () => { if (!(wide && jumpToPanel(id))) setOpen(id); };
  const d = cc.data;
  const loading = cc.loading && !d;
  const failed = !d && !!cc.error;

  // Money
  const m = d?.money ?? null;
  const moneyBig = m ? nowrap(usd(m.total)) : "No balance yet";
  const moneyDays = m?.runway_days ?? null;
  const moneySub = m
    ? <>
        {m.runway_date ? <>Runs to about {nowrap(monthDay(m.runway_date + "T12:00:00Z"))} if nothing comes in (estimate). </> : null}
        {m.next_deposit ? <>Next deposit about {nowrap(usd(m.next_deposit.amount))} ({whenShort(m.next_deposit.expected_at)}).</> : null}
      </>
    : "Waiting for the first Mercury update.";

  // Turo
  const t = d?.turo;
  const cur = t?.widget?.current ?? null;
  const trip = t?.trips?.find((x) => !x.in_progress) ?? t?.trips?.[0] ?? null;
  const car = t?.ready?.next;
  const owed = t?.owed ?? 0;
  const turoWhen = cur ? cur.ends_at : trip ? (trip.in_progress ? trip.ends_at : trip.starts_at) : null;
  const turoBig = turoWhen ? nowrap(whenShort(turoWhen)) : "No trips booked";
  const turoSub = turoWhen
    ? <>
        {cur ? `${cur.guest} returns the car. ` : trip ? `${trip.guest} ${trip.in_progress ? "returns it" : "picks up"}. ` : ""}
        {car?.battery_pct != null && car?.need_pct != null ? <>Car at {nowrap(`${car.battery_pct}%`)}, {car.battery_pct >= car.need_pct ? "ready" : <>needs {nowrap(`${car.need_pct}%`)}</>}. </> : null}
        {owed > 0 ? <>Supercharging owed {nowrap(usd(owed))}.</> : "Nothing owed for Supercharging."}
      </>
    : "Nothing on the calendar.";
  const turoDays = daysUntil(turoWhen);

  // AI team
  const ai = d?.ai;
  const lineup = useLineup(ai?.employees);
  const stuckN = stuck ?? (ai?.stuck ?? []).length;   // same count as the Stuck section above
  const aiBig = needs == null ? (loading ? "Checking" : "Needs you") : needs === 0 ? "Nothing needs you" : nowrap(`${needs} need you`);
  const aiSub = ai
    ? <>
        {lineup.length ? <>{lineup.length} {lineup.length === 1 ? "job runs" : "jobs run"} in the next 24 hours, first at {nowrap(time12(lineup[0].at))}. </> : "No scheduled jobs in the next 24 hours. "}
        AI spend {nowrap(usd(ai.spend_today))} of {nowrap(usd(ai.cap, false))}.
      </>
    : "Waiting for the team report.";

  // My day
  const ups = upcoming(meetings, evs);
  const nm = ups[0] ?? (meetings.next === undefined && !evs ? undefined : null);
  const after = ups.find((e, i) => i > 0 && e.title.toLowerCase() !== nm?.title.toLowerCase());
  const calls = d?.myday?.calls;
  const peak = wx ? rainPeak(wx.hours) : null;
  const rain = peak && peak.pct >= 50 ? { rain: peak.pct, t: peak.t } : null;   // same peak as the weather card's headline and chip
  const dayBig = nm ? nowrap(whenShort(nm.start)) : nm === undefined ? "Checking" : "Nothing booked";
  const daySub = (
    <>
      {nm ? <>{nm.title}{after ? <>, then {after.title} {nowrap(whenShort(after.start))}</> : ""}{/[.!?]$/.test(after?.title ?? nm.title) ? " " : ". "}</> : nm === undefined ? "Reading your calendar. " : "Nothing on your calendar this week. "}
      {calls ? (calls.count > 0 ? <>{nowrap(`${calls.count} ${calls.count === 1 ? "to-do" : "to-dos"}`)} from calls. </> : "No call to-dos. ") : null}
      {rain ? <>Rain {nowrap(`${rain.rain}%`)} around {nowrap(time12(rain.t))}.</> : wx ? "No rain today." : null}
    </>
  );
  const dayDays = nm ? daysUntil(nm.start) : null;

  const fail = failed ? <LoadError label="this card" onRetry={() => cc.reload()} busy={cc.busy} detail={cc.error} /> : null;
  const st = (k: "ok" | "loading" | "error") => k;
  const base = loading ? st("loading") : failed ? st("error") : st("ok");

  return (
    <>
      <section aria-label="Your answers" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {failed ? (
          <div className={cn(cardCls, "p-4 sm:col-span-2 xl:col-span-4")}>{fail}</div>
        ) : (
          <>
            <LeadCard id="money" icon={Landmark} label="Money" state={base} big={moneyBig} sub={moneySub}
              chip={moneyDays != null ? <Pill tone={moneyDays < 14 ? "orange" : "neutral"}><span className="whitespace-nowrap">{moneyDays}&nbsp;days</span></Pill> : undefined}
              foot={m ? stamp(m.updated_at, 180) : null} onOpen={openIt("money")} wide={wide} />
            <LeadCard id="turo" icon={CarFront} label="Turo" state={base} big={turoBig} sub={turoSub}
              chip={turoDays != null ? <Pill tone="blue">{inDays(turoDays)}</Pill> : undefined}
              foot={t?.widget?.observed_at ? stamp(t.widget.observed_at, 60) : d ? stamp(d.at, 30) : null} onOpen={openIt("turo")} wide={wide} />
            <LeadCard id="ai" icon={Bot} label="AI team" state={base} big={aiBig} sub={aiSub}
              chip={stuckN ? <Pill tone="orange"><span className="whitespace-nowrap">{stuckN}&nbsp;stuck</span></Pill> : undefined}
              foot={d ? stamp(d.at, 15) : null} onOpen={openIt("ai")} wide={wide} />
            <LeadCard id="myday" icon={CalendarClock} label="My day" state={base} big={dayBig} sub={daySub}
              chip={dayDays != null ? <Pill tone="blue">{inDays(dayDays)}</Pill> : undefined}
              foot={d ? stamp(d.at, 15) : null} onOpen={openIt("myday")} wide={wide} />
          </>
        )}
      </section>

      <Sheet open={open !== null && !wide} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-lg bento:bg-[#F3F2EE]">
          {open && <SheetDetail open={open} cc={cc} wx={wx} meetings={meetings} lineup={lineup} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
