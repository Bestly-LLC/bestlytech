/**
 * Maya's ticket desk, moved out of MayaDesk.tsx so the agent template page (AgentDesk) can host it unchanged (modules "tickets" + "privacy").
 * Renders the at-a-glance numbers and the Sales and Service columns; the caller supplies the Messages column (her calls) so the three share one grid:
 *   Sales      open demo requests (kind sales_lead), plus a "Closed leads" disclosure
 *   Service    support_tickets that are not leads, soonest due first, plus a "Done" disclosure with Reopen
 * Data: support_tickets via admin_maya_tickets / admin_maya_ticket_set / admin_maya_counts (admin only). Plan: docs/maya-desk-columns-opusplan.md.
 * TicketCard and PrivacyCasePanel are untouched.
 *
 * Other template agents (Leo, 2026-10-11) pass `agent`: they get their own tickets (source 'agent:<slug>', via
 * admin_agent_tickets / admin_agent_ticket_counts), only Service and Messages, and no Sales column — they don't sell.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, LifeBuoy, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { CollapsibleSection } from "@/components/admin/roofguard/CollapsibleSection";
import { TicketCard, type TicketAct, type TicketMode } from "./TicketCard";
import { clock, type Ticket } from "./mayaFormat";

type View = "open" | "leads" | "done";
type Counts = { open: number; overdue: number; leads: number; privacy_open: number };
type Lists = Record<View, Ticket[] | null>;
type Errs = Record<View, string | null>;
const VIEWS: View[] = ["open", "leads", "done"];
const NB = " ";

function Stat({ label, value, warn }: { label: string; value: number | undefined; warn?: boolean }) {
  const hot = warn && (value ?? 0) > 0;
  return (
    <div className={cn("rounded-2xl px-3 py-3 ring-1", hot ? "bg-orange-500/10 ring-orange-500/30" : "bg-white/[0.04] ring-white/10")}>
      <div className={cn("text-[26px] font-semibold leading-none tabular-nums", hot ? "text-orange-300" : "text-white")}>{value ?? "–"}</div>
      <div className={cn("mt-1.5 text-[12px]", hot ? "text-orange-200" : "text-white/60")}>{label}</div>
    </div>
  );
}

/** Count pill in a column header. */
export function Pill({ n, hot, label }: { n: number | undefined; hot?: boolean; label: string }) {
  if (n == null) return null;
  return (
    <span aria-label={label} className={cn("inline-flex min-w-[28px] items-center justify-center rounded-full px-2.5 py-1 text-[13px] font-semibold tabular-nums",
      hot ? "bg-orange-500/20 text-orange-200" : n > 0 ? "bg-white/15 text-white" : "bg-white/[0.07] text-white/60")}>{n}</span>
  );
}

export const plural = (n: number, one: string, many: string) => `${n}${NB}${n === 1 ? one : many}`;
const box = "rounded-2xl bg-white/[0.04] p-5 text-[15px] text-white/75 ring-1 ring-white/10";
export const columnBodyCls = "space-y-3 p-3";

function Skeleton({ n, h = 150 }: { n: number; h?: number }) {
  return <>{Array.from({ length: n }, (_, i) => <div key={i} style={{ height: h }} className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />)}</>;
}

function ColError({ msg, retry }: { msg: string; retry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
      <p>{msg}</p>
      <button type="button" onClick={retry} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
    </div>
  );
}

/** Small disclosure row inside a column ("Done · 12"). Collapsed by default, expands in place. */
function Disclosure({ label, count, children }: { label: string; count: number | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-2xl px-3 text-left text-[15px] font-medium text-white/75 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-white/55 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        <span className="whitespace-nowrap">{label}{count != null ? ` · ${count}` : ""}</span>
      </button>
      {open && <div className="mt-2 space-y-3">{children}</div>}
    </div>
  );
}

/** Class names that place each column: phone Service, Sales, Messages; tablet Service | Messages then Sales; desktop Sales | Service | Messages. */
export const MESSAGES_ORDER = "order-3 lg:order-2 xl:order-3";

export function MayaTicketsModule({ messages, agent }: { messages: (orderCls: string) => ReactNode; agent?: { slug: string; name: string } }) {
  // Maya runs the sales + service desk; every other agent only has service tickets of its own.
  const solo = !!agent && agent.slug !== "maya";
  const slug = agent?.slug ?? "maya";
  const [counts, setCounts] = useState<Counts | null>(null);
  const [lists, setLists] = useState<Lists>({ open: null, leads: null, done: null });
  const [errs, setErrs] = useState<Errs>({ open: null, leads: null, done: null });
  const reqs = useRef<Record<View, number>>({ open: 0, leads: 0, done: 0 });
  const pending = useRef(0);     // writes in flight: a poll must not resurrect a card that was just closed

  const loadCounts = useCallback(async () => {
    const { data } = solo ? await rpcArgs<Counts>("admin_agent_ticket_counts", { p_slug: slug }) : await rpcArgs<Counts>("admin_maya_counts");
    if (data) setCounts(data);
  }, [solo, slug]);

  const loadView = useCallback(async (v: View) => {
    const id = ++reqs.current[v];
    if (solo && v === "leads") { setLists((l) => ({ ...l, leads: [] })); return; }
    const { data, error } = solo ? await rpcArgs<Ticket[]>("admin_agent_tickets", { p_slug: slug, p_view: v }) : await rpcArgs<Ticket[]>("admin_maya_tickets", { p_view: v });
    if (id !== reqs.current[v] || pending.current > 0) return;
    if (error) { setErrs((e) => ({ ...e, [v]: "Couldn't load tickets. Try again in a minute." })); return; }
    setErrs((e) => ({ ...e, [v]: null }));
    setLists((l) => ({ ...l, [v]: data ?? [] }));
  }, [solo, slug]);

  const refresh = useCallback(() => { VIEWS.forEach((v) => void loadView(v)); void loadCounts(); }, [loadView, loadCounts]);

  // Load everything, then keep it fresh every 60 seconds while the tab is visible.
  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    const vis = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [refresh]);

  const onAct: TicketAct = async (t, status, note) => {
    const before = lists;
    const from: View = t.status !== "open" ? "done" : t.kind === "sales_lead" ? "leads" : "open";
    setLists((l) => ({ ...l, [from]: (l[from] ?? []).filter((x) => x.code !== t.code) }));       // optimistic
    pending.current += 1;
    const { error } = await rpcArgs("admin_maya_ticket_set", { p_code: t.code, p_status: status, p_note: note });
    pending.current -= 1;
    if (error) {
      setLists(before);
      toast.error(`Couldn't update ${t.code}. Try again.`);
      return;
    }
    VIEWS.forEach((v) => void loadView(v)); void loadCounts();
    if (status === "open") { toast.success(`${t.code} reopened`); return; }
    toast(`${t.code} marked ${status === "spam" ? "spam" : "done"}`, {
      duration: 5000,
      action: { label: "Undo", onClick: async () => {
        const u = await rpcArgs("admin_maya_ticket_set", { p_code: t.code, p_status: "open", p_note: null });
        if (u.error) toast.error(`Couldn't undo for ${t.code}.`);
        VIEWS.forEach((v) => void loadView(v)); void loadCounts();
      } },
    });
  };

  const leads = lists.leads;
  const doneLeads = lists.done?.filter((t) => t.kind === "sales_lead") ?? null;
  const doneOther = lists.done?.filter((t) => t.kind !== "sales_lead") ?? null;

  const cards = (rows: Ticket[], mode: TicketMode) => rows.map((t) => <TicketCard key={t.code} t={t} mode={mode} onAct={onAct} />);
  const doneBlock = (label: string, rows: Ticket[] | null) => (
    <Disclosure label={label} count={rows ? rows.length : null}>
      {errs.done && <ColError msg={errs.done} retry={() => void loadView("done")} />}
      {rows === null && !errs.done && <Skeleton n={2} />}
      {rows?.length === 0 && <p className={box}>Nothing closed yet.</p>}
      {rows && cards(rows, "done")}
    </Disclosure>
  );

  // Closed-state summaries (shown in the header while a column is collapsed).
  const leadCount = counts?.leads ?? leads?.length;
  const newestLead = leads && leads.length ? leads.reduce((a, b) => (Date.parse(b.created_at) > Date.parse(a.created_at) ? b : a)) : null;
  const salesSummary = !leadCount ? "Nothing waiting" : `${plural(leadCount, "demo request", "demo requests")}${newestLead ? ` · newest ${clock(newestLead.created_at)}` : ""}`;

  const openCount = counts?.open ?? lists.open?.length;
  const serviceSummary = !openCount ? "Nothing waiting" : [
    `${openCount} open`,
    counts?.overdue ? `${counts.overdue} overdue` : null,
    counts?.privacy_open ? `${counts.privacy_open} privacy` : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <div className={cn("grid gap-2", solo ? "grid-cols-2 max-w-sm" : "grid-cols-4 xl:max-w-2xl")} aria-label="Tickets at a glance">
        <Stat label="Open" value={counts?.open} />
        <Stat label="Overdue" value={counts?.overdue} warn />
        {!solo && <Stat label="Leads" value={counts?.leads} />}
        {!solo && <Stat label="Privacy" value={counts?.privacy_open} />}
      </div>

      {/* Jared asked for all three columns to be collapsible (CollapsibleSection's header note about always-open areas does not apply here). */}
      <div className={cn("grid grid-cols-1 items-start gap-4 lg:grid-cols-2", !solo && "xl:grid-cols-3")}>
        {!solo && <CollapsibleSection id="maya-col-sales" defaultOpen className="order-2 lg:order-3 lg:col-span-2 xl:order-1 xl:col-span-1" bodyClassName={columnBodyCls}
          title="Sales" icon={<TrendingUp className="h-5 w-5 text-emerald-300" />} summary={salesSummary}
          badge={<Pill n={leadCount} label={`${leadCount ?? 0} open demo requests`} />}>
          {errs.leads && <ColError msg={errs.leads} retry={() => void loadView("leads")} />}
          {leads === null && !errs.leads && <Skeleton n={2} />}
          {leads?.length === 0 && <p className={box}>No demo requests yet. Maya pitches the Bestly Agent when a caller runs a business.</p>}
          {leads && cards(leads, "lead")}
          {doneBlock("Closed leads", doneLeads)}
        </CollapsibleSection>}

        <CollapsibleSection id={solo ? `${slug}-col-service` : "maya-col-service"} defaultOpen className="order-1 lg:order-1 xl:order-2" bodyClassName={columnBodyCls}
          title="Service" icon={<LifeBuoy className="h-5 w-5 text-sky-300" />} summary={serviceSummary}
          badge={<Pill n={openCount} hot={(counts?.overdue ?? 0) > 0} label={`${openCount ?? 0} open tickets${(counts?.overdue ?? 0) > 0 ? `, ${counts?.overdue} overdue` : ""}`} />}>
          {errs.open && <ColError msg={errs.open} retry={() => void loadView("open")} />}
          {lists.open === null && !errs.open && <Skeleton n={3} />}
          {lists.open?.length === 0 && <p className={box}>Nothing waiting. {agent?.name ?? "Maya"} has it covered.</p>}
          {lists.open && cards(lists.open, "followup")}
          {doneBlock("Done", doneOther)}
          {lists.done && lists.done.length >= 100 && <p className="px-1 text-[13px] text-white/55">Done shows the 100 most recent.</p>}
        </CollapsibleSection>

        {messages(MESSAGES_ORDER)}
      </div>
    </>
  );
}
