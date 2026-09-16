import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { PageHeader } from "@/components/admin/PageHeader";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { pollInterval } from "@/lib/polling";
import { fetchSystemHealth, failingSystems, healthHeadlineStatus, type SystemHealth } from "@/lib/systemHealth";
import { fetchAgentState, fetchPiholeStats, isAgentOnline, STATS_STALE_MS } from "@/services/homeHubApi";
import {
  fetchSweepState, fmtDay, laNowMinutes, upcomingSweepDays, weekdayOf, LA_TZ, SWEEP_DAYS,
  type SweepState,
} from "@/services/streetSweepingApi";

/**
 * Admin home ("Today"). Answer first, one list of what needs action, a row of status chips,
 * four pipeline numbers, and recent activity behind a disclosure. Nothing else.
 *
 * Every data source loads independently: a failure shows "Couldn't load X · Retry" in its own
 * spot and never reads as zero or as healthy.
 */

// Several tables and views here are not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

const POLL_MS = 60_000;
const DAY_MS = 86_400_000;
const STUCK_DEAL_DAYS = 7;

/* ───────── helpers ───────── */

function ageText(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const laDateOf = (ts: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: LA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

function laTodayLabel(): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

function toError(err: { message?: string } | null | undefined): Error {
  return new Error(err?.message || "unknown error");
}

/* ───────── data source hook ───────── */

interface Source<T> {
  data: T | undefined;
  error: string | null;
  /** True until the first load settles (success or failure). */
  loading: boolean;
  busy: boolean;
  reload: () => Promise<void>;
}

function useSource<T>(loader: () => Promise<T>, poll = false): Source<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const next = await loaderRef.current();
      setData(next);
      setError(null);
    } catch (e) {
      // Keep the last good data; the section shows the error beside it.
      setError((e as Error)?.message || "unknown error");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    if (!poll) return;
    const iv = setInterval(() => {
      if (!document.hidden) reload();
    }, pollInterval(POLL_MS));
    return () => clearInterval(iv);
  }, [reload, poll]);

  return { data, error, loading, busy, reload };
}

/* ───────── loaders ───────── */

interface Oldest<T> {
  count: number;
  oldest: T | null;
}

async function countWithOldest<T>(query: PromiseLike<{ data: T[] | null; count: number | null; error: { message?: string } | null }>): Promise<Oldest<T>> {
  const { data, count, error } = await query;
  if (error) throw toError(error);
  return { count: count ?? data?.length ?? 0, oldest: data?.[0] ?? null };
}

type ContactRow = { id: string; name: string | null; created_at: string };
type HireRow = { id: string; name: string | null; company: string | null; project_type: string | null; created_at: string };
type IntakeRow = { id: string; business_legal_name: string | null; status: string; updated_at: string | null; created_at: string };
type EmailRow = { template_name: string | null; error_message: string | null; created_at: string };
type LeadRow = { id: string; company_name: string | null; created_at: string };
type DealRow = { id: string; lead_id: string; company_name: string | null; current_stage: number; stage_changed_at: string | null; created_at: string };
type CyHealth = { needs_attention: number; patterns_serving: number };
type HomeHub = { online: boolean; blocking: "enabled" | "disabled" | "unknown" | null; stale: boolean };

const loadContacts = () =>
  countWithOldest<ContactRow>(
    db.from("contact_submissions").select("id, name, created_at", { count: "exact" })
      .eq("status", "new").order("created_at", { ascending: true }).limit(1),
  );

const loadHires = () =>
  countWithOldest<HireRow>(
    db.from("hire_requests").select("id, name, company, project_type, created_at", { count: "exact" })
      .eq("status", "new").order("created_at", { ascending: true }).limit(1),
  );

// Explicit columns only: seller_intakes also holds SSN, ID and bank fields.
const loadIntakes = () =>
  countWithOldest<IntakeRow>(
    db.from("seller_intakes").select("id, business_legal_name, status, updated_at, created_at", { count: "exact" })
      .in("status", ["Submitted", "In Review"]).order("updated_at", { ascending: true }).limit(1),
  );

const loadFailedEmails = () =>
  countWithOldest<EmailRow>(
    db.from("email_send_log").select("template_name, error_message, created_at", { count: "exact" })
      .eq("status", "failed").gte("created_at", new Date(Date.now() - DAY_MS).toISOString())
      .order("created_at", { ascending: false }).limit(1),
  );

/** Leads with no deal yet, or whose furthest deal is still at stage 1-2 (same rule as the sidebar badge). */
async function loadCloudLeads(): Promise<Oldest<LeadRow>> {
  const { data, count, error } = await db.from("v_cloud_leads_needing_action").select("id", { count: "exact" }).limit(100);
  if (error) throw toError(error);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const total = count ?? ids.length;
  if (ids.length === 0) return { count: total, oldest: null };
  const oldest = await db.from("cloud_leads").select("id, company_name, created_at")
    .in("id", ids).order("created_at", { ascending: true }).limit(1);
  if (oldest.error) throw toError(oldest.error);
  return { count: total, oldest: (oldest.data?.[0] as LeadRow | undefined) ?? null };
}

/** Deals between discovery (3) and install (7). Feeds both "stuck" rows and the in-progress number. */
async function loadActiveDeals(): Promise<DealRow[]> {
  const { data, error } = await db.from("cloud_deals")
    .select("id, lead_id, company_name, current_stage, stage_changed_at, created_at")
    .gte("current_stage", 3).lte("current_stage", 7).limit(500);
  if (error) throw toError(error);
  return (data ?? []) as DealRow[];
}

async function loadCount(query: PromiseLike<{ count: number | null; error: { message?: string } | null }>): Promise<number> {
  const { count, error } = await query;
  if (error) throw toError(error);
  if (typeof count !== "number") throw new Error("no count returned");
  return count;
}

const weekAgoIso = () => new Date(Date.now() - 7 * DAY_MS).toISOString();
const loadNewLeads = () => loadCount(db.from("cloud_leads").select("id", { count: "exact", head: true }).gte("created_at", weekAgoIso()));
// Comps are granted through Stripe-less rows whose customer id starts with "granted_".
const loadPaidSubs = () =>
  loadCount(db.from("subscriptions").select("id", { count: "exact", head: true })
    .eq("status", "active").not("stripe_customer_id", "like", "granted\\_%"));
const loadWaitlist = () => loadCount(db.from("waitlist_subscribers").select("id", { count: "exact", head: true }).gte("created_at", weekAgoIso()));

async function loadCyHealth(): Promise<CyHealth> {
  // needs_attention is count(*) of v_cookieyeti_needs_attention.
  const { data, error } = await db.from("v_cookieyeti_pipeline_health").select("needs_attention, patterns_serving").maybeSingle();
  if (error) throw toError(error);
  if (!data) throw new Error("no pipeline health row");
  return { needs_attention: Number(data.needs_attention) || 0, patterns_serving: Number(data.patterns_serving) || 0 };
}

async function loadHomeHub(): Promise<HomeHub> {
  const [agent, stats] = await Promise.all([fetchAgentState(), fetchPiholeStats()]);
  return {
    online: isAgentOnline(agent),
    blocking: stats ? stats.status : null,
    stale: !stats || Date.now() - new Date(stats.capturedAt).getTime() > STATS_STALE_MS,
  };
}

/* ───────── derived: street sweeping (same rules as the Street Sweeping page) ───────── */

type Tone = "ok" | "warn" | "bad";

interface Need {
  id: string;
  title: string;
  why: string;
  href?: string;
  urgent?: boolean;
}

const CHECK_OUTCOMES = ["alerted", "safe_side", "not_on_street", "location_error"];

function sweepSummary(s: SweepState): { tone: Tone; word: string; need: Need | null } {
  const today = s.la_today;
  const todaySide = SWEEP_DAYS[weekdayOf(today)] ?? null;
  const nowMin = laNowMinutes();
  const inWindowToday = !!todaySide && nowMin < 600 && !s.config.skip_dates.includes(today);
  const latestToday = s.runs.find((r) => laDateOf(r.ran_at) === today && CHECK_OUTCOMES.includes(r.outcome)) ?? null;
  // Checks run every 30 min from 6:55am. Past 7:05 with nothing logged in 40 min, they've stopped.
  const lastCheck = s.runs.find((r) => r.outcome !== "test") ?? null;
  const checksMissing = inWindowToday && nowMin >= 425
    && (!lastCheck || Date.now() - new Date(lastCheck.ran_at).getTime() > 40 * 60_000);
  const href = "/admin/street-sweeping";
  const curb = todaySide ? `${todaySide[0].toUpperCase()}${todaySide.slice(1)} curb` : "";

  if (!s.config.alerts_enabled) return { tone: "warn", word: "Alerts paused", need: null };
  if (inWindowToday && s.acked_today) return { tone: "ok", word: "Handled today", need: null };
  if (checksMissing) {
    return {
      tone: "bad",
      word: "No check ran",
      need: { id: "sweep-missing", urgent: true, href, title: "Check where Blue Steel is parked", why: `No street-sweeping check has run. ${curb} is swept today, 8–10am.` },
    };
  }
  if (inWindowToday && latestToday?.outcome === "alerted") {
    return {
      tone: "bad",
      word: "Move car",
      need: { id: "sweep-move", urgent: true, href, title: "Move Blue Steel", why: `It's on the ${latestToday.side ?? todaySide} curb. Sweeping 8–10am, $75 ticket.` },
    };
  }
  if (inWindowToday && latestToday?.outcome === "location_error") {
    return {
      tone: "warn",
      word: "Location unknown",
      need: { id: "sweep-location", href, title: "Check where Blue Steel is parked", why: `Couldn't read the car's location. ${curb} is swept today, 8–10am.` },
    };
  }
  if (inWindowToday) return { tone: "ok", word: latestToday ? "Safe today" : "Alerts on", need: null };
  const next = upcomingSweepDays(today, s.config.skip_dates, 6).find((d) => !d.skipped);
  if (!next) return { tone: "warn", word: "All sweeps skipped", need: null };
  const day = fmtDay(next.date, { weekday: "short" });
  if (s.last_location?.side && s.last_location.side === next.side) {
    return { tone: "warn", word: `Car on ${next.side} curb · ${day}`, need: null };
  }
  return { tone: "ok", word: `Next ${day} · alerts on`, need: null };
}

/* ───────── derived: Cloud deals ───────── */

const STAGE: Record<number, { label: string; next: string }> = {
  3: { label: "Discovery", next: "hold the call and send the quote" },
  4: { label: "SOW + deposit", next: "get it signed and the deposit paid" },
  5: { label: "Tech intake", next: "get the client to finish intake" },
  6: { label: "Provisioning", next: "finish building the box" },
  7: { label: "Install", next: "finish the install and go live" },
};

function stuckDeals(deals: DealRow[]): DealRow[] {
  const cutoff = Date.now() - STUCK_DEAL_DAYS * DAY_MS;
  return deals
    .filter((d) => new Date(d.stage_changed_at || d.created_at).getTime() < cutoff)
    .sort((a, b) => new Date(a.stage_changed_at || a.created_at).getTime() - new Date(b.stage_changed_at || b.created_at).getTime());
}

/* ───────── small UI pieces ───────── */

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80";

function SectionTitle({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 id={id} className="text-xs font-semibold uppercase tracking-widest text-white/55">{children}</h2>
      {aside}
    </div>
  );
}

function RetryButton({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`Retry loading ${label}`}
      className={cn("inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-indigo-300 hover:text-indigo-200 hover:bg-white/5 disabled:opacity-60", focusRing)}
    >
      <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
      {busy ? "Retrying…" : "Retry"}
    </button>
  );
}

function LoadError({ label, source }: { label: string; source: Source<unknown> }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
      <span title={source.error ?? undefined}>Couldn't load {label}</span>
      <span className="text-white/40" aria-hidden>·</span>
      <RetryButton onClick={() => source.reload()} busy={source.busy} label={label} />
    </div>
  );
}

const TONE: Record<Tone, { icon: typeof CheckCircle2; text: string }> = {
  ok: { icon: CheckCircle2, text: "text-emerald-300" },
  warn: { icon: AlertTriangle, text: "text-amber-300" },
  bad: { icon: XCircle, text: "text-red-300" },
};

const chipBase = "inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-white/10 px-3 text-sm";

function StatusChip({ label, source, to, render }: {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: Source<any>;
  to: string;
  /** hideLabel: the word already says it all (e.g. "All systems OK"). */
  render: () => { tone: Tone; word: string; hideLabel?: boolean } | null;
}) {
  if (source.loading) {
    return <li><Skeleton className="h-9 w-40 rounded-full bg-white/[0.05]" /></li>;
  }
  if (source.error) {
    return (
      <li>
        <button
          type="button"
          onClick={() => source.reload()}
          disabled={source.busy}
          title={source.error}
          className={cn(chipBase, "text-white/70 hover:bg-white/5 disabled:opacity-60", focusRing)}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <span className="min-w-0 truncate">{label}: couldn't load</span>
          <span className="text-white/40" aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 text-indigo-300">
            <RefreshCw className={cn("h-3.5 w-3.5", source.busy && "animate-spin")} aria-hidden /> Retry
          </span>
        </button>
      </li>
    );
  }
  const r = render();
  if (!r) return null;
  const { icon: Icon, text } = TONE[r.tone];
  return (
    <li>
      <Link to={to} className={cn(chipBase, "hover:bg-white/5 hover:border-white/20 transition-colors", focusRing)}>
        <Icon className={cn("h-4 w-4 shrink-0", text)} aria-hidden />
        {!r.hideLabel && <span className="text-white/70 shrink-0">{label}</span>}
        <span className={cn("min-w-0 truncate font-medium", text)}>{r.word}</span>
      </Link>
    </li>
  );
}

function WeekItem({ source, to, label, render }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: Source<any>;
  to: string;
  label: string;
  render: () => { value: number; text: string; extra?: string };
}) {
  if (source.loading) {
    return (
      <li className="flex items-baseline gap-2 py-1">
        <Skeleton className="h-7 w-8 bg-white/[0.06]" />
        <Skeleton className="h-4 w-36 bg-white/[0.04]" />
      </li>
    );
  }
  if (source.error) {
    return <li className="py-1"><LoadError label={label} source={source} /></li>;
  }
  const { value, text, extra } = render();
  return (
    <li>
      <Link to={to} className={cn("group inline-flex items-baseline gap-2 rounded-md py-1 pr-1", focusRing)}>
        <span className="text-2xl font-medium tabular-nums text-white">{value.toLocaleString()}</span>
        <span className="text-sm text-white/70 group-hover:text-white transition-colors">{text}</span>
        {extra && <span className="text-sm text-white/55">{extra}</span>}
      </Link>
    </li>
  );
}

/* ───────── page ───────── */

export default function AdminDashboard() {
  // Needs you + status poll every minute; the weekly numbers load once (and on Refresh now).
  const contacts = useSource(loadContacts, true);
  const hires = useSource(loadHires, true);
  const intakes = useSource(loadIntakes, true);
  const emails = useSource(loadFailedEmails, true);
  const cloudLeads = useSource(loadCloudLeads, true);
  const deals = useSource(loadActiveDeals, true);
  const sweep = useSource(fetchSweepState, true);
  const health = useSource<SystemHealth>(fetchSystemHealth, true);
  const homeHub = useSource(loadHomeHub, true);
  const cy = useSource(loadCyHealth, true);
  const newLeads = useSource(loadNewLeads);
  const paidSubs = useSource(loadPaidSubs);
  const waitlist = useSource(loadWaitlist);

  const [showRecent, setShowRecent] = useState(false);
  const [activityKey, setActivityKey] = useState(0);

  const all = [contacts, hires, intakes, emails, cloudLeads, deals, sweep, health, homeHub, cy, newLeads, paidSubs, waitlist];
  const refreshAll = async () => {
    setActivityKey((k) => k + 1);
    await Promise.all(all.map((s) => s.reload()));
  };

  /* Needs you, in priority order: time-bound first, then money, then people waiting, then upkeep. */
  const needSources: { label: string; source: Source<unknown> }[] = [
    { label: "Cloud leads", source: cloudLeads },
    { label: "Cloud deals", source: deals },
    { label: "hire requests", source: hires },
    { label: "contact messages", source: contacts },
    { label: "seller intakes", source: intakes },
    { label: "Cookie Yeti fixes", source: cy },
    { label: "failed emails", source: emails },
  ];
  const needsLoading = needSources.some((n) => n.source.loading) || sweep.loading || health.loading;

  const needs: Need[] = [];
  if (sweep.data) {
    const n = sweepSummary(sweep.data).need;
    if (n) needs.push(n);
  }
  if (health.data && health.data.downSystems.length > 0) {
    const names = health.data.downSystems;
    needs.push({
      id: "system-alert",
      urgent: true,
      title: `${names.length} ${plural(names.length, "system is", "systems are")} down`,
      why: `The health check flagged ${names.slice(0, 3).join(", ")}.`,
      // check-system-health watches the Cookie Yeti AI generator and cron, which live on the CY ops page.
      href: "/admin/cookie-yeti/ops",
    });
  }
  if (cloudLeads.data && cloudLeads.data.count > 0) {
    const { count, oldest } = cloudLeads.data;
    const who = oldest?.company_name || "a lead";
    needs.push({
      id: "cloud-leads",
      title: count === 1 ? `Book a discovery call with ${who}` : `${count} Cloud leads to move to a call`,
      why: count === 1
        ? `New lead or brief still open${oldest ? ` · ${ageText(oldest.created_at)} old` : ""}.`
        : `Still at lead or brief stage · oldest ${who}${oldest ? `, ${ageText(oldest.created_at)}` : ""}.`,
      href: count === 1 && oldest ? `/admin/cloud/${oldest.id}` : "/admin/cloud",
    });
  }
  if (deals.data) {
    const stuck = stuckDeals(deals.data);
    if (stuck.length > 0) {
      const d = stuck[0];
      const stage = STAGE[d.current_stage];
      const since = ageText(d.stage_changed_at || d.created_at);
      needs.push({
        id: "cloud-stuck",
        title: stuck.length === 1 ? `Unstick ${d.company_name || "a Cloud deal"}` : `${stuck.length} Cloud deals stuck`,
        why: stuck.length === 1
          ? `${stage?.label ?? `Stage ${d.current_stage}`} for ${since} · next: ${stage?.next ?? "move it forward"}.`
          : `Oldest: ${d.company_name || "unnamed"}, ${stage?.label ?? `stage ${d.current_stage}`} for ${since} · next: ${stage?.next ?? "move it forward"}.`,
        href: stuck.length === 1 ? `/admin/cloud/${d.lead_id}` : "/admin/cloud",
      });
    }
  }
  if (hires.data && hires.data.count > 0) {
    const { count, oldest } = hires.data;
    const from = oldest ? `${oldest.name || "someone"}${oldest.company ? ` (${oldest.company})` : ""}` : "someone";
    needs.push({
      id: "hires",
      title: count === 1 ? `Reply to hire request from ${from}` : `Reply to ${count} hire requests`,
      why: count === 1
        ? `${oldest?.project_type ? `${oldest.project_type} · ` : ""}waiting ${ageText(oldest?.created_at)}.`
        : `Oldest from ${from}, waiting ${ageText(oldest?.created_at)}.`,
      href: "/admin/hires",
    });
  }
  if (contacts.data && contacts.data.count > 0) {
    const { count, oldest } = contacts.data;
    const from = oldest?.name || "someone";
    needs.push({
      id: "contacts",
      title: count === 1 ? `Reply to ${from}` : `Reply to ${count} contact messages`,
      why: count === 1 ? `New contact message · waiting ${ageText(oldest?.created_at)}.` : `Oldest from ${from}, waiting ${ageText(oldest?.created_at)}.`,
      href: "/admin/contacts",
    });
  }
  if (intakes.data && intakes.data.count > 0) {
    const { count, oldest } = intakes.data;
    const biz = oldest?.business_legal_name || "Unnamed";
    const since = ageText(oldest?.updated_at || oldest?.created_at);
    needs.push({
      id: "intakes",
      title: count === 1 ? `Review seller intake: ${biz}` : `Review ${count} seller intakes`,
      why: count === 1 ? `${oldest?.status} · no change for ${since}.` : `Oldest: ${biz}, ${oldest?.status} for ${since}.`,
      href: count === 1 && oldest ? `/admin/submissions/${oldest.id}` : "/admin/submissions",
    });
  }
  if (cy.data && cy.data.needs_attention > 0) {
    const n = cy.data.needs_attention;
    needs.push({
      id: "cy-attention",
      title: `Help Auto-Fix with ${n} Cookie Yeti ${plural(n, "site", "sites")}`,
      why: "About 30 seconds each. The page tells you exactly what to tap.",
      href: "/admin/cookie-yeti/autofix",
    });
  }
  if (emails.data && emails.data.count > 0) {
    const { count, oldest } = emails.data;
    const detail = [oldest?.template_name, oldest?.error_message].filter(Boolean).join(": ").slice(0, 100);
    needs.push({
      id: "emails",
      title: `${count} ${plural(count, "email", "emails")} failed to send today`,
      // There is no email log page in the admin yet, so this row has nowhere to link.
      why: detail ? `Latest: ${detail}` : "Check the email provider and the send-email function logs.",
    });
  }

  const needErrors = needSources.filter((n) => n.source.error);
  const urgentCount = needs.filter((n) => n.urgent).length;

  /* Status */
  const sweepChip = () => (sweep.data ? sweepSummary(sweep.data) : null);
  const healthChip = () => {
    if (!health.data) return null;
    const status = healthHeadlineStatus(health.data);
    const failing = failingSystems(health.data);
    if (status === "ok") return { tone: "ok" as Tone, word: "All systems OK", hideLabel: true };
    if (status === "down") return { tone: "bad" as Tone, word: `${failing.join(", ")} down` };
    if (status === "warn") {
      return { tone: "warn" as Tone, word: failing.length ? `${failing.join(", ")} degraded` : "Unverified" };
    }
    return { tone: "warn" as Tone, word: "Unknown" };
  };
  const homeHubChip = () => {
    const h = homeHub.data;
    if (!h) return null;
    if (!h.online) return { tone: "bad" as Tone, word: "Agent offline" };
    if (h.stale) return { tone: "warn" as Tone, word: "Online · stats stale" };
    if (h.blocking === "disabled") return { tone: "warn" as Tone, word: "Online · blocking off" };
    if (h.blocking !== "enabled") return { tone: "warn" as Tone, word: "Online · blocking unknown" };
    return { tone: "ok" as Tone, word: "Online · blocking on" };
  };
  const cyChip = () => {
    const c = cy.data;
    if (!c) return null;
    if (c.patterns_serving === 0) return { tone: "bad" as Tone, word: "No patterns serving" };
    if (c.needs_attention > 0) return { tone: "warn" as Tone, word: `${c.needs_attention} need you` };
    return { tone: "ok" as Tone, word: "Serving OK" };
  };

  return (
    <div className="mx-auto max-w-3xl space-y-10 pb-8">
      <PageHeader
        title="Today"
        description={laTodayLabel()}
        actions={
          <ActionMenu
            label="More actions"
            items={[{ label: "Refresh now", icon: RefreshCw, onSelect: refreshAll }]}
          />
        }
      />

      {/* 1 ─ Needs you */}
      <section aria-labelledby="needs-title" aria-busy={needsLoading}>
        <SectionTitle
          id="needs-title"
          aside={
            !needsLoading && needs.length > 0 ? (
              <p className="text-sm text-white/70 tabular-nums">
                {needs.length} {plural(needs.length, "thing", "things")}
                {urgentCount > 0 && <span className="text-red-300"> · {urgentCount} urgent</span>}
              </p>
            ) : undefined
          }
        >
          Needs you
        </SectionTitle>

        {needsLoading ? (
          <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06]">
            {[0, 1, 2].map((i) => (
              <li key={i} className="px-4 py-4 sm:px-5 space-y-2">
                <Skeleton className="h-4 w-2/3 bg-white/[0.06]" />
                <Skeleton className="h-3.5 w-1/2 bg-white/[0.04]" />
              </li>
            ))}
          </ul>
        ) : needs.length === 0 && needErrors.length === 0 ? (
          <p className="flex items-center gap-2.5 rounded-2xl border border-white/[0.06] px-4 py-4 sm:px-5 text-[0.9375rem] text-white/80">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
            You're clear for today.
          </p>
        ) : (
          <div className="rounded-2xl border border-white/[0.06] overflow-hidden">
            {needs.length > 0 && (
              <ul className="divide-y divide-white/[0.06]">
                {needs.map((n) => {
                  const body = (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.9375rem] font-medium text-white">
                          {n.urgent && (
                            <span className="mr-2 inline-flex items-center rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 align-middle text-xs font-semibold text-red-300">
                              Urgent
                            </span>
                          )}
                          {n.title}
                        </p>
                        <p className="mt-1 text-sm text-white/55">{n.why}</p>
                      </div>
                      {n.href && (
                        <ChevronRight className="h-4 w-4 shrink-0 text-white/40 transition-colors group-hover:text-white/80" aria-hidden />
                      )}
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {n.href ? (
                        <Link
                          to={n.href}
                          className={cn("group flex items-center gap-3 px-4 py-4 sm:px-5 hover:bg-white/[0.03] transition-colors focus-visible:ring-inset", focusRing)}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 px-4 py-4 sm:px-5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {needErrors.length > 0 && (
              <ul className={cn("space-y-1 px-4 py-3 sm:px-5", needs.length > 0 && "border-t border-white/[0.06]")}>
                {needErrors.map((n) => (
                  <li key={n.label}><LoadError label={n.label} source={n.source} /></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* 2 ─ Status */}
      <section aria-labelledby="status-title">
        <SectionTitle id="status-title">Status</SectionTitle>
        <ul className="flex flex-wrap gap-2">
          <StatusChip label="System" source={health} to="/admin/cookie-yeti/ops" render={healthChip} />
          <StatusChip label="Home Hub" source={homeHub} to="/admin/home-hub" render={homeHubChip} />
          <StatusChip label="Street Sweeping" source={sweep} to="/admin/street-sweeping" render={sweepChip} />
          <StatusChip label="Cookie Yeti" source={cy} to="/admin/cookie-yeti" render={cyChip} />
        </ul>
      </section>

      {/* 3 ─ This week */}
      <section aria-labelledby="week-title">
        <SectionTitle id="week-title" aside={<p className="text-xs text-white/55">New = last 7 days</p>}>
          This week
        </SectionTitle>
        <ul className="flex flex-col gap-y-1 sm:flex-row sm:flex-wrap sm:gap-x-8">
          <WeekItem
            source={deals}
            to="/admin/cloud"
            label="Cloud deals"
            render={() => {
              const rows = deals.data ?? [];
              const byStage = [3, 4, 5, 6, 7]
                .map((s) => ({ s, n: rows.filter((d) => d.current_stage === s).length }))
                .filter((x) => x.n > 0)
                .map((x) => `${x.n} ${STAGE[x.s].label.toLowerCase()}`);
              return {
                value: rows.length,
                text: plural(rows.length, "Cloud deal in progress", "Cloud deals in progress"),
                extra: byStage.length ? `(${byStage.join(", ")})` : undefined,
              };
            }}
          />
          <WeekItem
            source={newLeads}
            to="/admin/cloud"
            label="new leads"
            render={() => ({ value: newLeads.data ?? 0, text: plural(newLeads.data ?? 0, "new Cloud lead", "new Cloud leads") })}
          />
          <WeekItem
            source={paidSubs}
            to="/admin/cookie-yeti/subscribers"
            label="paid subscribers"
            render={() => ({ value: paidSubs.data ?? 0, text: plural(paidSubs.data ?? 0, "paid Cookie Yeti subscriber", "paid Cookie Yeti subscribers") })}
          />
          <WeekItem
            source={waitlist}
            to="/admin/waitlist"
            label="waitlist signups"
            render={() => ({ value: waitlist.data ?? 0, text: plural(waitlist.data ?? 0, "new waitlist signup", "new waitlist signups") })}
          />
        </ul>
      </section>

      {/* 4 ─ Recent (collapsed by default; the feed only loads once opened) */}
      <section aria-label="Recent activity">
        <button
          type="button"
          aria-expanded={showRecent}
          aria-controls="recent-activity"
          onClick={() => setShowRecent((v) => !v)}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-md px-2 -ml-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors", focusRing)}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", showRecent && "rotate-180")} aria-hidden />
          {showRecent ? "Hide recent activity" : "Show recent activity"}
        </button>
        {showRecent && (
          <div id="recent-activity" className="mt-3 rounded-2xl border border-white/[0.06]">
            <ActivityFeed key={activityKey} limit={5} embedded />
          </div>
        )}
      </section>
    </div>
  );
}
