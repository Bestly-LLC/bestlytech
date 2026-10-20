/**
 * The four lead cards (Money / Turo / AI team / My day): one answer each, readable at a glance on a phone,
 * tap to open the detail in a sheet. Each card says how fresh it is in its own footer ("Updated 8:05 PM", or
 * "Updated 3 hours ago" once behind) and degrades on its own: a failing source never blanks the page.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bot, CalendarClock, ChevronRight, ExternalLink, Landmark, Video, CarFront } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { LoadError, Pill, RowLink, SectionHeader, cardCls, divider, focusRing, hairline, inset, rowCls, text } from "@/components/admin/ui";
import {
  ageWords, dayShort, monthDay, nextRun, stamp, time12, usd, whenShort, type CcBundle, type Live, type Wx,
} from "@/lib/commandCenter";
import type { NextEvent } from "@/pages/partner/PartnerExtras";

type Meetings = { next: NextEvent | null | undefined; events: NextEvent[] };
type Open = null | "money" | "turo" | "ai" | "myday";

const nowrap = (s: string) => <span className="whitespace-nowrap tabular-nums">{s}</span>;

function Bar({ pct, tone = "blue" }: { pct: number; tone?: "blue" | "orange" | "green" }) {
  const c = tone === "orange" ? "bg-[#FF9F0A] bento:bg-[#C93400]" : tone === "green" ? "bg-[#30D158] bento:bg-[#248A3D]" : "bg-[#409CFF] bento:bg-[#007AFF]";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]" role="presentation">
      <div className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", c)} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
    </div>
  );
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const k = (d: Date) => new Date(d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })).getTime();
  return Math.round((k(new Date(iso)) - k(new Date())) / 864e5);
}
const inDays = (n: number | null) => (n == null ? "" : n <= 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`);

/* ───────── one card ───────── */

function LeadCard({ id, icon: Icon, label, big, sub, chip, foot, onOpen, state }: {
  id: string; icon: typeof Landmark; label: string; big: ReactNode; sub: ReactNode; chip?: ReactNode;
  foot: { text: string; stale: boolean } | null; onOpen: () => void; state: "ok" | "loading" | "error";
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${label}. Open details.`}
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

export function LeadCards({ cc, wx, needs, meetings }: { cc: Live<CcBundle>; wx: Wx | undefined; needs: number | null; meetings: Meetings }) {
  const [open, setOpen] = useState<Open>(null);
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
        {m.next_deposit ? <>Next in: {nowrap(usd(m.next_deposit.amount))} {whenShort(m.next_deposit.expected_at)}.</> : null}
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
  const lineup = useMemo(() => {
    const now = new Date();
    return (ai?.employees ?? [])
      .map((e) => ({ ...e, at: nextRun(e.schedule, now) }))
      .filter((e): e is typeof e & { at: Date } => !!e.at && e.at.getTime() - now.getTime() < 24 * 36e5)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [ai?.employees]);
  const stuck = ai?.stuck ?? [];
  const aiBig = needs == null ? (loading ? "Checking" : "Needs you") : needs === 0 ? "Nothing needs you" : nowrap(`${needs} need you`);
  const aiSub = ai
    ? <>
        {lineup.length ? <>{lineup.length} {lineup.length === 1 ? "job runs" : "jobs run"} in the next 24 hours, first at {nowrap(time12(lineup[0].at))}. </> : "No scheduled jobs in the next 24 hours. "}
        AI spend {nowrap(usd(ai.spend_today))} of {nowrap(usd(ai.cap, false))}.
      </>
    : "Waiting for the team report.";

  // My day
  const nm = meetings.next;
  const calls = d?.myday?.calls;
  const rain = wx?.hours.slice(0, 24).find((h) => h.rain >= 50);
  const after = meetings.events.find((e) => e !== nm);
  const dayBig = nm ? nowrap(whenShort(nm.start)) : nm === undefined ? "Checking" : "No meetings";
  const daySub = (
    <>
      {nm ? <>{nm.title}{after ? <>, then {after.title} {nowrap(whenShort(after.start))}</> : ""}. </> : nm === undefined ? "Reading your calendar. " : "Nothing on your calendar this week. "}
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
              foot={m ? stamp(m.updated_at, 180) : null} onOpen={() => setOpen("money")} />
            <LeadCard id="turo" icon={CarFront} label="Turo" state={base} big={turoBig} sub={turoSub}
              chip={turoDays != null ? <Pill tone="blue">{inDays(turoDays)}</Pill> : undefined}
              foot={t?.widget?.observed_at ? stamp(t.widget.observed_at, 60) : d ? stamp(d.at, 30) : null} onOpen={() => setOpen("turo")} />
            <LeadCard id="ai" icon={Bot} label="AI team" state={base} big={aiBig} sub={aiSub}
              chip={stuck.length ? <Pill tone="orange">{stuck.length} stuck</Pill> : undefined}
              foot={d ? stamp(d.at, 15) : null} onOpen={() => setOpen("ai")} />
            <LeadCard id="myday" icon={CalendarClock} label="My day" state={base} big={dayBig} sub={daySub}
              chip={dayDays != null ? <Pill tone="blue">{inDays(dayDays)}</Pill> : undefined}
              foot={d ? stamp(d.at, 15) : null} onOpen={() => setOpen("myday")} />
          </>
        )}
      </section>

      <Sheet open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-lg bento:bg-[#F3F2EE]">
          {open === "money" && <MoneyDetail m={m} />}
          {open === "turo" && <TuroDetail d={d} />}
          {open === "ai" && <AiDetail d={d} lineup={lineup} />}
          {open === "myday" && <MyDayDetail d={d} meetings={meetings} wx={wx} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ───────── details ───────── */

function Head({ title, desc }: { title: string; desc: string }) {
  return (
    <div className={cn("border-b py-5 pr-14", hairline, inset)}>
      <SheetTitle className="text-[22px] font-semibold tracking-tight text-white">{title}</SheetTitle>
      <SheetDescription className="mt-1 text-[14px] text-white/60">{desc}</SheetDescription>
    </div>
  );
}
const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="pt-5"><SectionHeader title={title} /><div className={cn(cardCls, "mx-4 overflow-hidden sm:mx-6")}>{children}</div></section>
);
const KV = ({ k, v, sub }: { k: ReactNode; v: ReactNode; sub?: ReactNode }) => (
  <li className={cn(rowCls, "items-start justify-between")}>
    <div className="min-w-0"><p className={text.title}>{k}</p>{sub && <p className={cn(text.detail, "mt-0.5")}>{sub}</p>}</div>
    <p className="shrink-0 text-[15px] font-medium tabular-nums text-white">{v}</p>
  </li>
);
const Note = ({ children }: { children: ReactNode }) => <p className={cn("pb-1 pt-3 text-[13px] leading-snug text-white/55", inset)}>{children}</p>;
const Empty = ({ children }: { children: ReactNode }) => <li className={cn(rowCls, "text-[15px] text-white/60")}>{children}</li>;

function MoneyDetail({ m }: { m: CcBundle["money"] }) {
  if (!m) return <><Head title="Money" desc="Mercury" /><Note>No Mercury balance has been saved yet. The bank job runs every 30 minutes.</Note></>;
  return (
    <>
      <Head title="Money in detail" desc={`${stamp(m.updated_at, 180).text}. Read-only from Mercury.`} />
      <Group title="Balances">
        <ul className={divider}>
          {m.accounts.map((a) => <KV key={a.name} k={a.name} sub={a.last4 ? `Account ending ${a.last4}` : undefined} v={usd(a.balance)} />)}
          <KV k="Total" v={usd(m.total)} />
        </ul>
      </Group>
      <Group title="Last 30 days">
        <ul className={divider}>
          <KV k="Money in" v={usd(m.in_30d)} />
          <KV k="Money out" v={usd(m.out_30d)} />
        </ul>
      </Group>
      <Group title="Runway (estimate)">
        <ul className={divider}>
          <KV k={m.runway_date ? `Lasts to about ${monthDay(m.runway_date + "T12:00:00Z")}` : "Not enough history"} sub={m.runway_days != null ? `${m.runway_days} days at ${usd(m.burn_daily)} a day` : undefined} v={m.runway_days != null ? `${m.runway_days} days` : ""} />
        </ul>
        <Note>An estimate, not a forecast. It is recalculated every day from the last 30 days of spending and assumes nothing comes in, so it is the worst case.</Note>
      </Group>
      <Group title="Coming up">
        <ul className={divider}>
          {m.next_deposit && <KV k="Next deposit" sub={`${m.next_deposit.basis}. Expected ${whenShort(m.next_deposit.expected_at)}.`} v={usd(m.next_deposit.amount)} />}
          {m.bills.map((b) => <KV key={b.name} k={b.name} sub={`${b.every_days === 30 ? "Monthly" : b.every_days === 14 ? "Every 2 weeks" : "Weekly"}, due about ${monthDay(b.next + "T12:00:00Z")}`} v={usd(b.amount)} />)}
          {!m.next_deposit && m.bills.length === 0 && <Empty>No recurring bills found yet.</Empty>}
        </ul>
        <Note>Bills are charges that repeat on a steady rhythm in your Mercury history.</Note>
      </Group>
      <div className={cn("py-5", inset)}>
        <a href="https://app.mercury.com" target="_blank" rel="noopener noreferrer" className={cn("inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-[#409CFF] bento:text-[#007AFF]", focusRing)}>
          Open Mercury <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      </div>
    </>
  );
}

function TuroDetail({ d }: { d: CcBundle | undefined }) {
  const t = d?.turo;
  const w = t?.widget;
  const car = t?.ready?.next;
  const pct = car?.battery_pct ?? w?.battery ?? null;
  const need = car?.need_pct ?? null;
  return (
    <>
      <Head title="Turo in detail" desc={w?.observed_at ? `Car data ${stamp(w.observed_at, 60).text.toLowerCase()}.` : "Trips and the car."} />
      <Group title="Trips">
        <ul className={divider}>
          {(t?.trips ?? []).map((x) => (
            <KV key={x.id} k={`${x.guest}${x.car ? " · " + x.car : ""}`} sub={`${x.in_progress ? "On the road. Returns" : "Pickup"} ${whenShort(x.in_progress ? x.ends_at : x.starts_at)}${x.in_progress ? "" : `, return ${whenShort(x.ends_at)}`}`} v={x.earnings != null ? usd(x.earnings) : ""} />
          ))}
          {(t?.trips ?? []).length === 0 && <Empty>No upcoming trips.</Empty>}
        </ul>
      </Group>
      <Group title="Car for the next trip">
        <div className="space-y-2 px-4 py-4 sm:px-6">
          <p className="flex items-baseline justify-between gap-3 text-[15px] text-white">
            <span>Charge {pct != null ? nowrap(`${pct}%`) : "unknown"}{need != null && <span className="text-white/60"> of {nowrap(`${need}%`)} needed</span>}</span>
            {pct != null && need != null && <span className={cn("whitespace-nowrap text-[13px] font-medium", pct >= need ? "text-[#30D158] bento:text-[#248A3D]" : "text-[#FF9F0A] bento:text-[#C93400]")}>{pct >= need ? "Ready" : "Plug it in"}</span>}
          </p>
          {pct != null && <Bar pct={pct} tone={need != null && pct < need ? "orange" : "green"} />}
        </div>
        <ul className={cn("border-t", hairline, divider)}>
          {(t?.ready?.checks ?? []).map((c) => <KV key={c.id} k={c.label} sub={c.hint} v={<span className={c.state === "warn" ? "text-[#FF9F0A] bento:text-[#C93400]" : ""}>{c.value}</span>} />)}
          <KV k="Supercharging owed" v={usd(t?.owed ?? 0)} />
        </ul>
      </Group>
      <div className={cn("py-5", inset)}>
        <Link to="/admin/turo" className={cn("inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-[#409CFF] bento:text-[#007AFF]", focusRing)}>Open Turo <ChevronRight className="h-4 w-4" aria-hidden /></Link>
      </div>
    </>
  );
}

function AiDetail({ d, lineup }: { d: CcBundle | undefined; lineup: { slug: string; name: string; role: string; schedule: string; at: Date }[] }) {
  const ai = d?.ai;
  const pct = ai && ai.cap > 0 ? (ai.spend_today / ai.cap) * 100 : 0;
  return (
    <>
      <Head title="AI team in detail" desc={`${ai?.employee_count ?? 0} employees on the roster.`} />
      <Group title="AI spend today">
        <div className="space-y-2 px-4 py-4 sm:px-6">
          <p className="flex items-baseline justify-between text-[15px] text-white"><span>{nowrap(usd(ai?.spend_today ?? 0))} of {nowrap(usd(ai?.cap ?? 0, false))}</span><span className="text-[13px] text-white/60">resets at midnight Pacific</span></p>
          <Bar pct={pct} tone={pct > 80 ? "orange" : "blue"} />
        </div>
      </Group>
      <Group title="Stuck">
        <ul className={divider}>
          {(ai?.stuck ?? []).map((s) => <KV key={s.slug} k={s.name} sub={s.summary || "Last run failed."} v={<span className="text-[13px] font-normal text-white/60">{ageWords(s.at)}</span>} />)}
          {(ai?.stuck ?? []).length === 0 && <Empty>Nothing is stuck.</Empty>}
        </ul>
        <Note>A job shows here when its latest run failed in the last 3 days, or a Pi job failed twice in a row.</Note>
      </Group>
      <Group title="What they will do next">
        <ul className={divider}>
          {lineup.slice(0, 8).map((e) => <KV key={e.slug} k={e.name} sub={e.role} v={whenShort(e.at)} />)}
          {lineup.length === 0 && <Empty>No scheduled jobs in the next 24 hours.</Empty>}
        </ul>
      </Group>
      <div className={cn("py-5", inset)}>
        <Link to="/admin/team" className={cn("inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-[#409CFF] bento:text-[#007AFF]", focusRing)}>Open Team <ChevronRight className="h-4 w-4" aria-hidden /></Link>
      </div>
    </>
  );
}

function MyDayDetail({ d, meetings, wx }: { d: CcBundle | undefined; meetings: Meetings; wx: Wx | undefined }) {
  const calls = d?.myday?.calls;
  const nm = meetings.next;
  return (
    <>
      <Head title="My day in detail" desc="Meetings, call to-dos and the weather." />
      <div className={cn("pt-5", inset)}>
        <a href={nm?.join_url ?? "https://cloud.bestly.tech/call/sm33w3fu"} target="_blank" rel="noreferrer"
          className={cn("inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-[#0A84FF] px-4 text-[15px] font-semibold text-white active:scale-[0.98] bento:bg-[#007AFF]", focusRing)}>
          <Video className="h-5 w-5" aria-hidden /> {nm ? "Join next meeting" : "Open the call room"}
        </a>
      </div>
      <Group title="Meetings">
        <ul className={divider}>
          {meetings.events.slice(0, 6).map((e, i) => <KV key={i} k={e.title} sub={e.calendar} v={whenShort(e.start)} />)}
          {meetings.events.length === 0 && <Empty>{nm === undefined ? "Reading your calendar." : "Nothing on your calendar this week."}</Empty>}
        </ul>
      </Group>
      <Group title="To-dos from calls">
        <ul className={divider}>
          {(calls?.top ?? []).map((c) => <li key={c.id}><RowLink href="/admin/scout-day#calls"><p className={text.title}>{c.title}</p></RowLink></li>)}
          {(calls?.count ?? 0) === 0 && <Empty>No call to-dos on you.</Empty>}
          {(calls?.count ?? 0) > (calls?.top.length ?? 0) && <li><RowLink href="/admin/scout-day#calls"><p className={text.title}>All {calls?.count}</p></RowLink></li>}
        </ul>
      </Group>
      {wx && (
        <Group title="Weather">
          <ul className={divider}>
            <KV k={`${wx.now.cond} now`} v={`${Math.round(wx.now.tempF)}\u00a0°F`} />
            {wx.days.slice(0, 3).map((x, i) => <KV key={x.t} k={i === 0 ? "Today" : dayShort(x.t + 6 * 36e5)} sub={x.cond} v={`${Math.round(x.hiF)}\u00a0°F / ${Math.round(x.loF)}\u00a0°F`} />)}
          </ul>
        </Group>
      )}
      <div className="h-5" />
    </>
  );
}
