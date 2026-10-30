/**
 * Command Center detail panels (Money / Turo / AI team / My day).
 *
 * One set of panels, two homes:
 *   - lg and up: always on the page under the weather, in two columns from xl ("In detail"), the way the approved mockup shows them.
 *     Tapping a lead card scrolls to its panel and gives it a short, soft glow (none with reduced motion).
 *   - phone: the same panels open in a side sheet when a lead card is tapped (the approved phone behavior).
 *
 * Every panel says how fresh its source is in its own line ("Updated 8:05 PM", or "Updated 3 hours ago" in orange once behind)
 * and degrades on its own: a stale or failing source never leaves a blank card.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bot, CalendarClock, CarFront, ChevronRight, ExternalLink, Landmark, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { LoadError, Pill, RowLink, SectionHeader, cardCls, divider, focusRing, hairline, inset, rowCls, text } from "@/components/admin/ui";
import { ageWords, dayShort, glue, monthDay, nextRun, stamp, usd, whenShort, type CcBundle, type Live, type Wx } from "@/lib/commandCenter";
import type { NextEvent } from "@/pages/partner/PartnerExtras";

export type Meetings = { next: NextEvent | null | undefined; events: NextEvent[] };
export type PanelId = "money" | "turo" | "ai" | "myday";

type Mode = "sheet" | "inline";
const ModeCtx = createContext<Mode>("sheet");
const useInline = () => useContext(ModeCtx) === "inline";

export const nowrap = (s: string) => <span className="whitespace-nowrap tabular-nums">{s}</span>;

/* ───────── wide screens ───────── */

const WIDE = "(min-width: 1024px)";

/** True from lg up. Decides between "scroll to the panel" and "open it in a sheet". */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(WIDE);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

const GLOW_EVENT = "cc:glow";

/** Scroll the panel into view (smoothly, unless the person asked for less motion) and ask it to glow once. */
export function jumpToPanel(id: PanelId): boolean {
  const el = document.getElementById(`cc-panel-${id}`);
  if (!el) return false;
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  window.dispatchEvent(new CustomEvent(GLOW_EVENT, { detail: id }));
  return true;
}

/* ───────── shared bits ───────── */

function Bar({ pct, tone = "blue" }: { pct: number; tone?: "blue" | "orange" | "green" }) {
  const c = tone === "orange" ? "bg-[#FF9F0A] bento:bg-[#C93400]" : tone === "green" ? "bg-[#30D158] bento:bg-[#248A3D]" : "bg-[#409CFF] bento:bg-[#007AFF]";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]" role="presentation">
      <div className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", c)} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
    </div>
  );
}

/** The first line of a failure, in plain words: no stack trace, no exception names, nothing cut off mid-word. */
export function plainSummary(raw: string | undefined | null): string {
  const first = (raw ?? "").split("\n")[0].trim().replace(/^[A-Za-z]*(Error|Exception):\s*/, "");
  if (!first) return "Last run failed.";
  if (first.length <= 120) return first;
  let out = "";
  for (const part of first.split("; ")) {
    const next = out ? `${out}; ${part}` : part;
    if (next.length > 120) break;
    out = next;
  }
  return out || first.slice(0, Math.max(1, first.lastIndexOf(" ", 120)));
}

type Fresh = { text: string; stale: boolean };

function Head({ id, icon: Icon, title, desc, fresh }: { id: PanelId; icon: LucideIcon; title: string; desc: string; fresh: Fresh | null }) {
  const inline = useInline();
  const foot = fresh && (
    <p className={cn("mt-1 text-[12px] tabular-nums", fresh.stale ? "text-[#FF9F0A] bento:text-[#C93400]" : "text-white/45")} data-testid={`panel-${id}-fresh`} data-stale={fresh.stale ? "true" : "false"}>
      {fresh.text}
    </p>
  );
  if (inline) {
    return (
      <div className={cn("border-b pb-4 pt-5", hairline, inset)}>
        <h3 id={`cc-panel-${id}-title`} className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.02em] text-white/60">
          <Icon className="h-4 w-4" aria-hidden />{title}
        </h3>
        <p className="mt-1 text-[14px] text-white/60">{desc}</p>
        {foot}
      </div>
    );
  }
  return (
    <div className={cn("border-b py-5 pr-14", hairline, inset)}>
      <SheetTitle className="text-[22px] font-semibold tracking-tight text-white">{title}</SheetTitle>
      <SheetDescription className="mt-1 text-[14px] text-white/60">{desc}</SheetDescription>
      {foot}
    </div>
  );
}

const Group = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => {
  const inline = useInline();
  return inline ? (
    <section className="pt-5">
      <SectionHeader title={title} aside={aside} as="h4" />
      <div className={cn("border-t", hairline)}>{children}</div>
    </section>
  ) : (
    <section className="pt-5"><SectionHeader title={title} aside={aside} /><div className={cn(cardCls, "mx-4 overflow-hidden sm:mx-6")}>{children}</div></section>
  );
};
const KV = ({ k, v, sub }: { k: ReactNode; v: ReactNode; sub?: ReactNode }) => (
  <li className={cn(rowCls, "items-start justify-between")}>
    <div className="min-w-0"><p className={text.title}>{k}</p>{sub && <p className={cn(text.detail, "mt-0.5")}>{typeof sub === "string" ? glue(sub) : sub}</p>}</div>
    <p className="shrink-0 whitespace-nowrap text-[15px] font-medium tabular-nums text-white">{v}</p>
  </li>
);
const Note = ({ children }: { children: ReactNode }) => <p className={cn("pb-1 pt-3 text-[13px] leading-snug text-white/55", inset)}>{children}</p>;
const Empty = ({ children }: { children: ReactNode }) => <li className={cn(rowCls, "text-[15px] text-white/60")}>{children}</li>;
const Foot = ({ children }: { children: ReactNode }) => <div className={cn("py-4", inset)}>{children}</div>;
const linkCls = cn("inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-[#409CFF] bento:text-[#007AFF]", focusRing);

/** What a panel shows before its source has answered: a quiet skeleton while loading, a retry when it failed. Never blank. */
function Waiting({ cc, label }: { cc: Live<CcBundle>; label: string }) {
  return (
    <div className={cn("py-5", inset)}>
      {cc.loading ? (
        <div className="space-y-3" aria-hidden><div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06] motion-reduce:animate-none" /><div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.04] motion-reduce:animate-none" /></div>
      ) : (
        <LoadError label={label} onRetry={() => cc.reload()} busy={cc.busy} detail={cc.error} />
      )}
    </div>
  );
}

/* ───────── the schedule: "what they will do next" ───────── */

export type LineupRow = { slug: string; name: string; role: string; schedule: string; at: Date };

export function useLineup(employees: CcBundle["ai"]["employees"] | undefined): LineupRow[] {
  return useMemo(() => {
    const now = new Date();
    return (employees ?? [])
      .map((e) => ({ ...e, at: nextRun(e.schedule, now) }))
      .filter((e): e is typeof e & { at: Date } => !!e.at && e.at.getTime() - now.getTime() < 24 * 36e5)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [employees]);
}

/* ───────── details ───────── */

export function MoneyDetail({ m }: { m: CcBundle["money"] }) {
  if (!m) {
    return (
      <>
        <Head id="money" icon={Landmark} title="Money in detail" desc="Read-only from Mercury." fresh={{ text: "Waiting for the first update", stale: true }} />
        <Note>No Mercury balance has been saved yet. The bank job runs every 30 minutes.</Note>
      </>
    );
  }
  const fresh = stamp(m.updated_at, 180);
  return (
    <>
      <Head id="money" icon={Landmark} title="Money in detail" desc="Read-only from Mercury." fresh={fresh} />
      {fresh.stale && <Note>These are the last balances Mercury gave us. The bank connection needs attention, so they may be behind.</Note>}
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
      <Foot><a href="https://app.mercury.com" target="_blank" rel="noopener noreferrer" className={linkCls}>Open Mercury <ExternalLink className="h-4 w-4" aria-hidden /></a></Foot>
    </>
  );
}

type Step = { key: string; tone: "green" | "orange" | "blue" | "gray"; title: string; sub: string };
const DOT: Record<Step["tone"], string> = {
  green: "bg-[#30D158] bento:bg-[#248A3D]",
  orange: "bg-[#FF9F0A] bento:bg-[#C93400]",
  blue: "bg-[#0A84FF] bento:bg-[#007AFF]",
  gray: "bg-white/30",
};

/** Now, then plug in if the car is short, then pickup, then return. Built only from what the bundle holds. */
function tripSteps(d: CcBundle | undefined): Step[] {
  const t = d?.turo;
  const w = t?.widget;
  const car = t?.ready?.next;
  const trip = t?.trips?.[0];
  const cur = w?.current;
  const pct = car?.battery_pct ?? w?.battery ?? null;
  const need = car?.need_pct ?? null;
  const spot = t?.ready?.checks?.find((c) => c.id === "spot")?.value;
  const out: Step[] = [];
  const nowBits = [
    spot ? `parked at ${spot}` : "parked",
    w?.locked == null ? null : w.locked ? "locked" : "unlocked",
    pct != null ? `${pct}% charged` : null,
    w?.range != null ? `about ${w.range} mi of range` : null,
  ].filter(Boolean);
  out.push({ key: "now", tone: "green", title: cur ? "On a trip now" : "Now", sub: cur ? `${cur.guest} returns it ${whenShort(cur.ends_at)}.` : `${w?.car ?? "The car"} is ${nowBits.join(", ")}.` });
  if (!cur && pct != null && need != null && pct < need) out.push({ key: "plug", tone: "orange", title: "Before the trip", sub: `Plug it in. It needs ${need}% for this trip.` });
  if (trip && !trip.in_progress) {
    out.push({ key: "pickup", tone: "blue", title: whenShort(trip.starts_at), sub: `${trip.guest} picks up${car?.place === "home" ? " at home" : ""}.` });
    out.push({ key: "return", tone: "gray", title: whenShort(trip.ends_at), sub: `Returns.${trip.earnings != null ? ` You earn ${usd(trip.earnings)}.` : ""}` });
  } else if (trip?.in_progress && !cur) {
    out.push({ key: "return", tone: "gray", title: whenShort(trip.ends_at), sub: `${trip.guest} returns it.${trip.earnings != null ? ` You earn ${usd(trip.earnings)}.` : ""}` });
  }
  return out;
}

export function TuroDetail({ d }: { d: CcBundle | undefined }) {
  const t = d?.turo;
  const w = t?.widget;
  const car = t?.ready?.next;
  const pct = car?.battery_pct ?? w?.battery ?? null;
  const need = car?.need_pct ?? null;
  const fresh = w?.observed_at ? stamp(w.observed_at, 60) : d ? stamp(d.at, 30) : null;
  const steps = tripSteps(d);
  const later = (t?.trips ?? []).slice(1);
  return (
    <>
      <Head id="turo" icon={CarFront} title="Turo in detail" desc="Between now and the next trip." fresh={fresh} />
      <Group title="Between now and the trip">
        {(t?.trips ?? []).length === 0 && !w?.current ? (
          <ul className={divider}><Empty>No upcoming trips.</Empty></ul>
        ) : (
          <ol className={cn("py-3", inset)} data-testid="turo-timeline">
            {steps.map((s, i) => (
              <li key={s.key} className="relative flex min-h-[44px] gap-3 pb-3 last:pb-0">
                {i < steps.length - 1 && <span className="absolute left-[7px] top-5 h-[calc(100%-8px)] w-px bg-white/15" aria-hidden />}
                <span className={cn("relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full", DOT[s.tone])} aria-hidden />
                <div className="min-w-0">
                  <p className={text.title}>{s.title}</p>
                  <p className={cn(text.detail, "mt-0.5")}>{glue(s.sub)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {later.length > 0 && (
          <ul className={cn("border-t", hairline, divider)}>
            {later.map((x) => <KV key={x.id} k={`${x.guest}${x.car ? " · " + x.car : ""}`} sub={`Pickup ${whenShort(x.starts_at)}, return ${whenShort(x.ends_at)}`} v={x.earnings != null ? usd(x.earnings) : ""} />)}
          </ul>
        )}
      </Group>
      <Group title="Car ready for the trip">
        <div className="space-y-2 px-4 py-4 sm:px-6">
          <p className="flex items-baseline justify-between gap-3 text-[15px] text-white">
            <span>Charge {pct != null ? nowrap(`${pct}%`) : "unknown"}{need != null && <span className="text-white/60"> of {nowrap(`${need}%`)} needed</span>}</span>
            {pct != null && need != null && <span className={cn("whitespace-nowrap text-[13px] font-medium", pct >= need ? "text-[#30D158] bento:text-[#248A3D]" : "text-[#FF9F0A] bento:text-[#C93400]")}>{pct >= need ? "Ready" : "Plug it in"}</span>}
          </p>
          {pct != null && <Bar pct={pct} tone={need != null && pct < need ? "orange" : "green"} />}
        </div>
        <ul className={cn("border-t", hairline, divider)}>
          {(t?.ready?.checks ?? []).filter((c) => c.id !== "charge").map((c) => <KV key={c.id} k={c.label} sub={c.hint} v={<span className={c.state === "warn" ? "text-[#FF9F0A] bento:text-[#C93400]" : ""}>{c.value}</span>} />)}
          <KV k="Supercharging owed" v={usd(t?.owed ?? 0)} />
        </ul>
      </Group>
      <Foot><Link to="/admin/turo" className={linkCls}>Open Turo <ChevronRight className="h-4 w-4" aria-hidden /></Link></Foot>
    </>
  );
}

export function AiDetail({ d, lineup }: { d: CcBundle | undefined; lineup: LineupRow[] }) {
  const inline = useInline();
  const ai = d?.ai;
  const pct = ai && ai.cap > 0 ? (ai.spend_today / ai.cap) * 100 : 0;
  return (
    <>
      <Head id="ai" icon={Bot} title="AI team in detail" desc={`${ai?.employee_count ?? 0} employees on the roster.`} fresh={d ? stamp(d.at, 15) : null} />
      <Group title="Lined up next">
        <ul className={divider}>
          {lineup.slice(0, inline ? 6 : 8).map((e) => <KV key={e.slug} k={e.name} sub={e.role} v={whenShort(e.at)} />)}
          {lineup.length === 0 && <Empty>No scheduled jobs in the next 24 hours.</Empty>}
        </ul>
        <Note>Schedules come from each employee's card. Jobs that run every few minutes are not listed.</Note>
      </Group>
      <Group title="AI spend today">
        <div className="space-y-2 px-4 py-4 sm:px-6">
          <p className="flex items-baseline justify-between gap-3 text-[15px] text-white"><span>{nowrap(usd(ai?.spend_today ?? 0))} of {nowrap(usd(ai?.cap ?? 0, false))}</span><span className="text-[13px] text-white/60">resets at midnight Pacific</span></p>
          <Bar pct={pct} tone={pct > 80 ? "orange" : "blue"} />
        </div>
      </Group>
      <Group title="Stuck">
        <ul className={divider}>
          {(ai?.stuck ?? []).map((s) => <KV key={`${s.kind}-${s.slug}`} k={s.name} sub={plainSummary(s.summary)} v={<span className="text-[13px] font-normal text-white/60">{ageWords(s.at)}</span>} />)}
          {(ai?.stuck ?? []).length === 0 && <Empty>Nothing is stuck.</Empty>}
        </ul>
        <Note>A job shows here when its latest run failed in the last 3 days, or a Pi job failed twice in a row.</Note>
      </Group>
      <Foot><Link to="/admin/team" className={linkCls}>Open Team <ChevronRight className="h-4 w-4" aria-hidden /></Link></Foot>
    </>
  );
}

export function MyDayDetail({ d, meetings, wx }: { d: CcBundle | undefined; meetings: Meetings; wx: Wx | undefined }) {
  const calls = d?.myday?.calls;
  const nm = meetings.next;
  return (
    <>
      <Head id="myday" icon={CalendarClock} title="My day in detail" desc="Meetings, call to-dos and the weather." fresh={d ? stamp(d.at, 15) : null} />
      <div className={cn("pt-5", inset)}>
        <a href={nm?.join_url ?? "https://cloud.bestly.tech/call/sm33w3fu"} target="_blank" rel="noreferrer"
          className={cn("inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-[#0A84FF] px-4 text-[15px] font-semibold text-white active:scale-[0.98] motion-reduce:active:scale-100 bento:bg-[#007AFF]", focusRing)}>
          <Video className="h-5 w-5" aria-hidden /> {nm ? "Join next meeting" : "Open the call room"}
        </a>
      </div>
      <Group title="Next meetings">
        <ul className={divider}>
          {meetings.events.slice(0, 6).map((e, i) => <KV key={i} k={e.title} sub={e.calendar} v={whenShort(e.start)} />)}
          {meetings.events.length === 0 && <Empty>{nm === undefined ? "Reading your calendar." : "Nothing on your calendar this week."}</Empty>}
        </ul>
      </Group>
      <Group title="Call to-dos due" aside={calls && calls.count > 0 ? <Link to="/admin/scout-day#calls" className={cn("inline-flex min-h-[44px] items-center px-1 text-[15px] font-medium text-[#409CFF] bento:text-[#007AFF]", focusRing)}>All {calls.count} open</Link> : undefined}>
        <ul className={divider}>
          {(calls?.top ?? []).map((c) => <li key={c.id}><RowLink href="/admin/scout-day#calls"><p className={text.title}>{c.title}</p></RowLink></li>)}
          {(calls?.count ?? 0) === 0 && <Empty>No call to-dos on you.</Empty>}
        </ul>
      </Group>
      {wx && (
        <Group title="Weather ahead">
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

/** The sheet body for a tapped lead card on a phone. */
export function SheetDetail({ open, cc, wx, meetings, lineup }: { open: PanelId; cc: Live<CcBundle>; wx: Wx | undefined; meetings: Meetings; lineup: LineupRow[] }) {
  const d = cc.data;
  return (
    <ModeCtx.Provider value="sheet">
      {open === "money" && <MoneyDetail m={d?.money ?? null} />}
      {open === "turo" && <TuroDetail d={d} />}
      {open === "ai" && <AiDetail d={d} lineup={lineup} />}
      {open === "myday" && <MyDayDetail d={d} meetings={meetings} wx={wx} />}
    </ModeCtx.Provider>
  );
}

/* ───────── the page section (lg and up) ───────── */

function Panel({ id, glow, children }: { id: PanelId; glow: number; children: ReactNode }) {
  return (
    <div id={`cc-panel-${id}`} className="relative scroll-mt-20" data-testid={`panel-${id}`}>
      {glow > 0 && (
        <span
          key={glow}
          aria-hidden
          data-testid={`panel-${id}-glow`}
          className="pointer-events-none absolute -inset-8 z-0 animate-cc-glow bg-[radial-gradient(closest-side,rgba(10,132,255,0.26),rgba(10,132,255,0.10)_65%,transparent)] motion-reduce:hidden"
        />
      )}
      <section aria-labelledby={`cc-panel-${id}-title`} className={cn(cardCls, "relative z-10 overflow-hidden pb-2")}>{children}</section>
    </div>
  );
}

/** "In detail": the four panels, always on the page from lg up (see the file header). */
export function DetailPanels({ cc, wx, meetings }: { cc: Live<CcBundle>; wx: Wx | undefined; meetings: Meetings }) {
  const d = cc.data;
  const lineup = useLineup(d?.ai?.employees);
  const [glow, setGlow] = useState<{ id: PanelId; n: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let n = 0;
    const on = (e: Event) => {
      n += 1;
      setGlow({ id: (e as CustomEvent<PanelId>).detail, n });
      clearTimeout(timer);
      timer = setTimeout(() => setGlow(null), 1900);
    };
    window.addEventListener(GLOW_EVENT, on);
    return () => { window.removeEventListener(GLOW_EVENT, on); clearTimeout(timer); };
  }, []);
  const g = (id: PanelId) => (glow?.id === id ? glow.n : 0);
  const body = (id: PanelId, icon: LucideIcon, title: string, label: string, node: ReactNode) => (
    d ? node : <><Head id={id} icon={icon} title={title} desc="Waiting for the first update." fresh={null} /><Waiting cc={cc} label={label} /></>
  );
  return (
    <ModeCtx.Provider value="inline">
      <section aria-labelledby="in-detail-title" data-testid="in-detail">
        <SectionHeader id="in-detail-title" title="In detail" />
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            <Panel id="money" glow={g("money")}>{body("money", Landmark, "Money in detail", "Money", <MoneyDetail m={d?.money ?? null} />)}</Panel>
            <Panel id="ai" glow={g("ai")}>{body("ai", Bot, "AI team in detail", "the AI team", <AiDetail d={d} lineup={lineup} />)}</Panel>
          </div>
          <div className="space-y-6">
            <Panel id="turo" glow={g("turo")}>{body("turo", CarFront, "Turo in detail", "Turo", <TuroDetail d={d} />)}</Panel>
            <Panel id="myday" glow={g("myday")}>{body("myday", CalendarClock, "My day in detail", "your day", <MyDayDetail d={d} meetings={meetings} wx={wx} />)}</Panel>
          </div>
        </div>
      </section>
    </ModeCtx.Provider>
  );
}
