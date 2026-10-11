/**
 * /admin/leads/hunter/scores: the Jev score screen. Who to call first, and why.
 * Every lead a caller may dial (Maya's from Hunter, Reese's RoofGuard list) has one row of odds: the chance a call reaches a
 * decision maker, how the call is likely to end, the best window, the likely role, and the fit. Priority = reach odds x fit.
 * Data: hunter_scores_list() (admin only). Read-only; nothing here changes a lead or places a call.
 * Design: one memorable thing per card, the reach odds as the big number. Filters and sort are native selects (phone friendly).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Gauge, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { ScrollSheet } from "@/components/admin/roofguard/AvaSheet";
import { NB, Stat, glue, when } from "@/components/admin/hunter/shared";
import {
  OUTCOMES, OutcomeBar, PriorityRing, RoleChip, ScorerBadge, StatusChip, WindowChip, WINDOW_LABEL,
  catLabel, pct, score100, topOutcome, type ScoreRow,
} from "@/components/admin/hunter/scoreUi";

type Summary = { scored: number; avg_reach: number | null; jev_pct: number; queued_today_maya: number; queued_today_reese: number };
type Payload = { summary: Summary; rows: ScoreRow[] };
type Who = "all" | "maya" | "reese";
type Sort = "priority" | "reach" | "fit" | "newest";

const PAGE = 30;
const SORTS: Array<[Sort, string]> = [["priority", "Priority"], ["reach", "Reach odds"], ["fit", "Fit"], ["newest", "Newest"]];
const WHO: Array<[Who, string]> = [["all", "All"], ["maya", "Maya"], ["reese", "Reese"]];

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] font-medium text-white/65">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl bg-white/[0.06] px-3 text-[15px] text-white outline-none ring-1 ring-white/10 focus:ring-white/40 [&>option]:bg-[#16161a]">
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

const INPUT_LABEL: Record<string, string> = {
  company: "Company", category: "Type", city: "City", state: "State", hours: "Opening hours", line_type: "Phone line", site: "Website check",
  site_summary: "What Hunter read", fit_score: "Earlier fit score", has_website: "Has a website", call_attempts: "Earlier call attempts",
  last_called_at: "Last called", status: "Status in Hunter", contact_title: "Contact title on file", timezone: "Time zone",
  site_model: "Sites", roof_volume: "Roof volume", footprint: "Footprint", risk_tier: "Storm risk tier", angle: "Why they matter", rg_priority: "RoofGuard rank",
};
const SITE_TEXT: Record<string, string> = { ok: "Read", none: "No website", blocked: "Asks robots not to read it", error: "Did not load" };
function showInput(k: string, v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (k === "category") return catLabel(String(v));
  if (k === "site") return SITE_TEXT[String(v)] ?? String(v);
  if (k === "last_called_at" && typeof v === "string") return when(v);
  if (k === "line_type") return ({ landline: "Landline", voip: "VoIP", mobile: "Mobile", unknown: "Unknown", unverified: "Not checked" } as Record<string, string>)[String(v)] ?? String(v);
  return String(v);
}

function LeadCard({ r, onOpen }: { r: ScoreRow; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`${r.company}. Reaches a decision maker ${pct(r.p_reach_dm)}. Open details.`}
        className="block w-full rounded-2xl bg-white/[0.04] p-4 text-left ring-1 ring-white/10 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 active:bg-white/[0.08]">
        <span className="flex items-start gap-3">
          <PriorityRing value={score100(r.priority)} />
          <span className="block min-w-0 flex-1">
            <span className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
              <span className="block min-w-0 flex-1 basis-40 break-words text-[16px] font-semibold leading-snug text-white">{r.company}</span>
              <StatusChip status={r.status} />
            </span>
            <span className="mt-0.5 block text-[13px] leading-snug text-white/65">
              {catLabel(r.category)}{r.place ? ` · ${r.place}` : ""}{" · "}{r.owner === "maya" ? "Maya" : "Reese"}
            </span>
          </span>
        </span>
        <span className="mt-3 block">
          <span className="block text-[12px] font-medium uppercase tracking-wide text-white/65">Reaches decision maker</span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-white">{pct(r.p_reach_dm)}</span>
            <span className="text-[13px] text-white/70">Fit{NB}<span className="tabular-nums text-white">{pct(r.p_fit)}</span></span>
          </span>
        </span>
        <span className="mt-3 block"><OutcomeBar probs={r.outcome_probs} /></span>
        <span className="mt-3 flex flex-wrap gap-1.5">
          <WindowChip w={r.best_window} />
          <RoleChip role={r.dm_role} />
          <ScorerBadge scorer={r.scorer} />
        </span>
        <span className="mt-3 block text-[14px] leading-relaxed text-white/80">{glue(r.reason)}</span>
      </button>
    </li>
  );
}

function Detail({ r }: { r: ScoreRow }) {
  const inputs = Object.entries(r.inputs ?? {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center gap-4">
        <PriorityRing value={score100(r.priority)} size={64} />
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wide text-white/65">Reaches decision maker</p>
          <p className="text-[40px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-white">{pct(r.p_reach_dm)}</p>
        </div>
      </div>
      <p className="text-[14px] leading-relaxed text-white/80">{glue(r.reason)}</p>
      <div className="flex flex-wrap gap-1.5"><StatusChip status={r.status} /><WindowChip w={r.best_window} /><RoleChip role={r.dm_role} /><ScorerBadge scorer={r.scorer} /></div>

      <section aria-label="How the call is likely to end">
        <h3 className="text-[15px] font-semibold text-white">How a call is likely to end</h3>
        <div className="mt-2.5"><OutcomeBar probs={r.outcome_probs} legend={false} /></div>
        <ul className="mt-3 space-y-2">
          {OUTCOMES.map((o) => (
            <li key={o.key} className="flex items-center justify-between gap-3 text-[14px]">
              <span className="inline-flex items-center gap-2 text-white/85"><span className={cn("h-2 w-2 rounded-full", o.dot)} aria-hidden />{o.label}</span>
              <span className="font-medium tabular-nums text-white">{pct(r.outcome_probs[o.key])}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="How the priority is made">
        <h3 className="text-[15px] font-semibold text-white">How the priority is made</h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-white/75">
          Reach odds {pct(r.p_reach_dm)} times fit {pct(r.p_fit)} gives a priority of {score100(r.priority)} out of 100. Higher goes first.
        </p>
      </section>

      <section aria-label="What the scorer was shown">
        <h3 className="text-[15px] font-semibold text-white">What the scorer was shown</h3>
        <p className="mt-1 text-[13px] text-white/60">No phone number, email or person's name is ever included.</p>
        <dl className="mt-2.5 divide-y divide-white/10 rounded-xl bg-white/[0.04] ring-1 ring-white/10">
          {inputs.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 px-3 py-2.5 text-[13px]">
              <dt className="text-white/65">{INPUT_LABEL[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</dt>
              <dd className="break-words text-white/90">{glue(showInput(k, v))}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-[13px] leading-relaxed text-white/60">
        {r.scorer === "jev"
          ? `Scored by Jev (${r.model ?? "jev-latest"})${r.latency_ms ? ` in ${r.latency_ms}${NB}ms` : ""} on ${when(r.scored_at)}.`
          : `A free AI estimate on ${when(r.scored_at)}. It is a reasoned guess, not a measured number. Jev numbers replace it once a key is saved.`}
      </p>
    </div>
  );
}

export default function HunterScores() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState<Who>("all");
  const [campaign, setCampaign] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [win, setWin] = useState("all");
  const [scorer, setScorer] = useState("all");
  const [sort, setSort] = useState<Sort>("priority");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<ScoreRow | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const { data: d, error } = await rpcArgs<Payload>("hunter_scores_list");
    setBusy(false);
    if (error || !d) { setErr("Couldn't load the scores. Try again in a minute."); return; }
    setErr(null); setData(d);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { setShown(PAGE); }, [who, campaign, outcome, win, scorer, sort]);

  const campaigns = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of data?.rows ?? []) if (r.campaign_slug && (who === "all" || r.owner === who)) seen.set(r.campaign_slug, r.campaign);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data, who]);

  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) =>
      (who === "all" || r.owner === who) && (campaign === "all" || r.campaign_slug === campaign) &&
      (outcome === "all" || topOutcome(r.outcome_probs) === outcome) && (win === "all" || r.best_window === win) && (scorer === "all" || r.scorer === scorer));
    const key: Record<Sort, (r: ScoreRow) => number> = {
      priority: (r) => r.priority, reach: (r) => r.p_reach_dm, fit: (r) => r.p_fit, newest: (r) => Date.parse(r.scored_at),
    };
    return list.sort((a, b) => key[sort](b) - key[sort](a));
  }, [data, who, campaign, outcome, win, scorer, sort]);

  const s = data?.summary;
  const counts = { all: data?.rows.length ?? 0, maya: data?.rows.filter((r) => r.owner === "maya").length ?? 0, reese: data?.rows.filter((r) => r.owner === "reese").length ?? 0 };
  const filtered = who !== "all" || campaign !== "all" || outcome !== "all" || win !== "all" || scorer !== "all";

  return (
    <div className="space-y-5 pb-24">
      <header className="space-y-3">
        <Link to="/admin/leads/hunter" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl pr-3 text-[14px] font-medium text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
          <ArrowLeft className="h-4 w-4" aria-hidden />Hunter
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-[2rem] font-bold leading-[1.1] tracking-[-0.015em] text-white sm:text-3xl">
              <Gauge className="h-7 w-7 shrink-0 text-white/70" aria-hidden />Lead scores
            </h1>
            <p className="mt-1.5 text-[15px] leading-relaxed text-white/70">Who to call first, and the odds a call reaches someone who can say yes.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/10 px-4 text-[15px] font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Scores at a glance">
          <Stat label="Leads scored" value={s?.scored} />
          <Stat label="Average reach odds" value={s ? pct(s.avg_reach) : undefined} />
          <Stat label="Queued today" value={s ? s.queued_today_maya + s.queued_today_reese : undefined} hint={s ? `Maya${NB}${s.queued_today_maya}, Reese${NB}${s.queued_today_reese}` : undefined} />
          <Stat label="Scored by Jev" value={s ? `${s.jev_pct}%` : undefined} hint={s && s.jev_pct < 100 ? "The rest are free AI estimates" : undefined} />
        </div>
      </header>

      {err && (
        <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
          <p>{err}</p>
          <button type="button" onClick={() => void load()} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
        </div>
      )}
      {!data && !err && Array.from({ length: 3 }, (_, i) => <div key={i} className="h-[220px] rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />)}

      {data && (<>
        <div className="space-y-3">
          <div role="group" aria-label="Whose leads" className="grid grid-cols-3 gap-1 rounded-2xl bg-white/[0.05] p-1 ring-1 ring-white/10">
            {WHO.map(([k, t]) => (
              <button key={k} type="button" aria-pressed={who === k} onClick={() => { setWho(k); setCampaign("all"); }}
                className={cn("min-h-[44px] rounded-xl px-2 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
                  who === k ? "bg-white/[0.14] text-white shadow-sm" : "text-white/70 hover:text-white")}>
                {t}<span className="ml-1.5 text-[12px] tabular-nums text-white/60">{counts[k]}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Select label="Campaign" value={campaign} onChange={setCampaign} options={[["all", "All campaigns"], ...campaigns]} />
            <Select label="Likely outcome" value={outcome} onChange={setOutcome} options={[["all", "Any outcome"], ...OUTCOMES.map((o) => [o.key, o.label] as [string, string])]} />
            <Select label="Best window" value={win} onChange={setWin} options={[["all", "Any window"], ...Object.entries(WINDOW_LABEL)]} />
            <Select label="Scored by" value={scorer} onChange={setScorer} options={[["all", "Jev or free AI"], ["jev", "Jev"], ["free_ai", "Free AI estimate"]]} />
            <div className="col-span-2 sm:col-span-1"><Select label="Sort by" value={sort} onChange={(v) => setSort(v as Sort)} options={SORTS} /></div>
          </div>
          <p className="text-[13px] text-white/65" role="status">
            {rows.length === 0 ? "No leads match." : `Showing ${Math.min(shown, rows.length)} of ${rows.length} ${rows.length === 1 ? "lead" : "leads"}.`}
            {filtered && (
              <button type="button" onClick={() => { setWho("all"); setCampaign("all"); setOutcome("all"); setWin("all"); setScorer("all"); }}
                className="ml-2 inline-flex min-h-[44px] items-center rounded-lg px-2 font-medium text-sky-300 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">Clear filters</button>
            )}
          </p>
        </div>

        {data.rows.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
            <p className="text-[16px] font-semibold text-white">Nothing is scored yet</p>
            <p className="mt-1 text-[14px] leading-relaxed text-white/70">Hunter scores leads overnight, between 1 and 5 AM. Scores for Maya's checked leads and Reese's callable leads show up here.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.slice(0, shown).map((r) => <LeadCard key={r.id} r={r} onOpen={() => setOpen(r)} />)}
          </ul>
        )}
        {rows.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE)}
            className="min-h-[48px] w-full rounded-2xl bg-white/10 text-[15px] font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
            Show {Math.min(PAGE, rows.length - shown)} more
          </button>
        )}
      </>)}

      <ScrollSheet open={!!open} onClose={() => setOpen(null)} title={open?.company ?? ""}
        description={open ? `${catLabel(open.category)}${open.place ? ` · ${open.place}` : ""} · ${open.owner === "maya" ? "Maya" : "Reese"}` : undefined}>
        {open && <Detail r={open} />}
      </ScrollSheet>
    </div>
  );
}
