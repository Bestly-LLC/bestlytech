/**
 * Ava's performance review: does she pay for herself, and what happens if she doesn't.
 * Data: rg_ava_review() (admin only). Rules live in the database (rg_review_calc); this only shows them.
 * Money is split honestly: "real" = deals Jared recorded as signed, "assumed" = meetings x close rate x his cut.
 * Hidden quietly if the RPC is not there yet, so the rest of the scorecard never breaks.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";

type Week = { week: string; dials: number; booked: number; result: "met" | "close" | "miss" };
type Verdict = "ramping" | "on_track" | "coaching" | "plan_due" | "on_plan" | "plan_passed" | "stop_review";
type Review = {
  verdict: Verdict; reason: string; next: string; floor: number; goal: number; weeks: Week[]; live_weeks: number; dry_dials: number; dry_limit: number;
  pip: { id: string; started_on: string; ends_on: string; target: number; trigger: string; reason: string | null; avg: number | null; weeks_done: number; days_left: number } | null;
  econ: { deal_cut_pct: number; rate_per_sqft: number; avg_roof_sqft: number; close_rate: number; horizon_months: number; pip_weeks: number; dry_spell_dials: number };
  roi: { monthly_per_deal: number; spend_total: number; spend_per_week: number; meetings: number; dials: number; cost_per_meeting: number | null; value_per_meeting: number;
    deals_real: number; mrr_real: number; deals_assumed: number; mrr_assumed: number; value_per_week_at_goal: number; breakeven_meetings: number | null;
    payback_months: number | null; payback_months_assumed: number | null; paid_back: boolean };
  deals: { id: string; company: string; signed_on: string; monthly_cut: number | null; note: string | null }[];
  plans: { id: string; started_on: string; ends_on: string; target: number; status: string; closed_on: string | null; outcome: string | null }[];
};

const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  ramping: { label: "Ramping up", tone: "bg-sky-400/15 text-sky-200" },
  on_track: { label: "On track", tone: "bg-emerald-400/15 text-emerald-200" },
  coaching: { label: "Coaching", tone: "bg-amber-400/15 text-amber-200" },
  plan_due: { label: "Plan due", tone: "bg-orange-400/15 text-orange-200" },
  on_plan: { label: "On improvement plan", tone: "bg-orange-400/15 text-orange-200" },
  plan_passed: { label: "Passed her plan", tone: "bg-emerald-400/15 text-emerald-200" },
  stop_review: { label: "Your decision", tone: "bg-rose-400/15 text-rose-200" },
};
const DOT: Record<Week["result"], string> = { met: "bg-emerald-400", close: "bg-amber-400", miss: "bg-rose-400" };

const usd = (n: number | null | undefined, d = 0) => n == null ? "–" : `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const day = (s: string) => new Date(s + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
type Fn = "rg_ava_review" | "rg_econ_set" | "rg_deal_add" | "rg_deal_delete" | "rg_pip_open" | "rg_pip_close";
type RpcCall = (n: Fn, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc: RpcCall = (name, args) => (supabase.rpc as unknown as RpcCall)(name, args);

function Card({ title, aside, children, label }: { title: string; aside?: ReactNode; children: ReactNode; label: string }) {
  return (
    <section className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10" aria-label={label}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-white">{title}</h3>{aside}
      </div>
      {children}
    </section>
  );
}
const Stat = ({ k, v, sub }: { k: string; v: ReactNode; sub?: string }) => (
  <div>
    <dt className="text-xs text-white/50">{k}</dt>
    <dd className="mt-1 whitespace-nowrap text-xl font-semibold tabular-nums text-white">{v}</dd>
    {sub && <dd className="text-xs text-white/55">{sub}</dd>}
  </div>
);
const btn = "min-h-[44px] rounded-xl px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300";

export function AvaReview() {
  const [r, setR] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [deal, setDeal] = useState({ company: "", cut: "" });
  const [sure, setSure] = useState<string | null>(null);
  const ask = (k: string, go: () => void) => { if (sure === k) { setSure(null); go(); } else { setSure(k); window.setTimeout(() => setSure((s) => (s === k ? null : s)), 4000); } };

  const load = useCallback(async () => {
    const { data, error } = await rpc("rg_ava_review");
    if (!error && data) setR(data as Review);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 120000); return () => clearInterval(t); }, [load]);

  const run = async (fn: Fn, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success(ok); await load(); }
  };

  if (!r) return null;
  const v = VERDICT[r.verdict];
  const { roi, econ, pip } = r;
  const planOpen = r.verdict === "plan_due" || r.verdict === "stop_review" || r.verdict === "coaching";
  const econFields: [string, string, string][] = [
    ["deal_cut_pct", "Your cut per deal", `${+(econ.deal_cut_pct * 100).toFixed(2)}`],
    ["close_rate", "Meetings that close", `${+(econ.close_rate * 100).toFixed(1)}`],
    ["avg_roof_sqft", "Roof size (sq ft)", `${econ.avg_roof_sqft}`],
    ["rate_per_sqft", "Price per sq ft a month ($)", `${econ.rate_per_sqft}`],
  ];
  const saveEcon = () => {
    const p: Record<string, number> = {};
    for (const [k, , cur] of econFields) {
      const raw = edit[k]; if (raw == null || raw === cur) continue;
      const n = Number(raw); if (!Number.isFinite(n) || n < 0) { toast.error("Numbers only"); return; }
      p[k] = k === "deal_cut_pct" || k === "close_rate" ? n / 100 : n;
    }
    if (!Object.keys(p).length) return;
    void run("rg_econ_set", { p }, "Saved").then(() => setEdit({}));
  };

  return (
    <div className="space-y-4" data-testid="ava-review">
      {/* verdict */}
      <Card label="Performance review" title="Performance review" aside={<span className={cn("whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium", v.tone)}>{v.label}</span>}>
        <p className="text-[17px] font-semibold leading-snug text-white">{r.reason}</p>
        <p className="mt-1 text-sm text-white/60"><b className="font-medium text-white/80">Next:</b> {r.next}</p>

        {r.weeks.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2" role="list" aria-label="Weekly results">
            {r.weeks.slice(-8).map((w) => (
              <div key={w.week} role="listitem" className="flex items-center gap-2 text-xs text-white/60">
                <span className={cn("h-2.5 w-2.5 rounded-full", DOT[w.result])} aria-hidden />
                <span className="whitespace-nowrap">{day(w.week)} <b className="tabular-nums text-white">{w.booked}</b> of {r.goal}</span>
                <span className="sr-only">{w.result === "met" ? "goal met" : w.result === "close" ? "close" : "missed"}</span>
              </div>
            ))}
          </div>
        ) : <p className="mt-4 text-xs text-white/60">No full weeks to grade yet. A week counts after 20 dials.</p>}

        <p className="mt-3 text-xs text-white/60">
          Floor is <span className="tabular-nums">{r.floor}</span> meetings a week. Two weeks under it, or <span className="tabular-nums">{r.dry_limit}</span> dials with no meeting, opens a {econ.pip_weeks}-week plan.
          Dials since her last meeting: <b className="tabular-nums text-white/70">{r.dry_dials}</b>.
        </p>

        {pip && (
          <div className="mt-4 rounded-2xl bg-orange-400/10 p-4 ring-1 ring-orange-300/20">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-orange-100">Plan: {pip.target} meetings a week</span>
              <span className="whitespace-nowrap text-xs text-orange-100/80">{day(pip.started_on)} to {day(pip.ends_on)} · {pip.days_left} days left</span>
            </div>
            <div className="mt-2 text-xs text-orange-100/80">So far: {pip.avg != null ? <b className="tabular-nums text-orange-50">{pip.avg}</b> : "no full week yet"}{pip.avg != null && " a week"} · started {pip.trigger === "auto" ? "automatically" : "by you"}</div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {!pip && planOpen && (
            <button type="button" disabled={busy} className={cn(btn, "bg-orange-400 text-black hover:bg-orange-300")}
              onClick={() => void run("rg_pip_open", { p_reason: r.reason }, "Plan started")}>Start improvement plan</button>
          )}
          {pip && (<>
            <button type="button" disabled={busy} className={cn(btn, "bg-emerald-400 text-black hover:bg-emerald-300")} onClick={() => void run("rg_pip_close", { p_status: "passed" }, "Plan closed as passed")}>Passed</button>
            <button type="button" disabled={busy} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")} onClick={() => ask("failed", () => void run("rg_pip_close", { p_status: "failed" }, "Plan closed as failed"))}>{sure === "failed" ? "Tap again to confirm" : "Ended without passing"}</button>
            <button type="button" disabled={busy} className={cn(btn, "text-white/60 hover:text-white")} onClick={() => ask("cancel", () => void run("rg_pip_close", { p_status: "cancelled" }, "Plan cancelled"))}>{sure === "cancel" ? "Tap again to confirm" : "Cancel plan"}</button>
          </>)}
        </div>
        {r.verdict === "stop_review" && <p className="mt-3 text-xs text-white/50">To stop her, turn calling off in Setup. Nothing switches her off automatically.</p>}
      </Card>

      {/* ROI */}
      <Card label="Return on Ava" title="Is she paying for herself?" aside={<ClipboardCheck className="h-4 w-4 text-white/30" aria-hidden />}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <Stat k="Spent so far" v={usd(roi.spend_total, 2)} sub={`${usd(roi.spend_per_week, 2)} a week lately`} />
          <Stat k="Cost per meeting" v={usd(roi.cost_per_meeting, 2)} sub={`${roi.meetings} booked, ${roi.dials} dials`} />
          <Stat k="Each meeting is worth" v={usd(roi.value_per_meeting)} sub={`assumed, first ${econ.horizon_months} months`} />
          <Stat k="Meetings to break even" v={roi.breakeven_meetings ?? "–"} sub="at that value" />
        </dl>
        <div className="mt-4 grid gap-3 border-t border-white/5 pt-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-emerald-400/10 p-4">
            <div className="text-xs text-emerald-100/80">Real: signed deals you recorded</div>
            <div className="mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums text-white">{usd(roi.mrr_real)}<span className="text-sm text-white/50">&nbsp;/&nbsp;mo</span></div>
            <div className="text-xs text-white/55">{roi.deals_real} deal{roi.deals_real === 1 ? "" : "s"}{roi.payback_months != null ? ` · paid back in ${roi.payback_months} months of that` : " · nothing signed yet"}</div>
          </div>
          <div className="rounded-2xl bg-white/[0.04] p-4">
            <div className="text-xs text-white/50">Assumed: meetings x close rate x your cut</div>
            <div className="mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums text-white/80">{usd(roi.mrr_assumed)}<span className="text-sm text-white/55">&nbsp;/&nbsp;mo</span></div>
            <div className="text-xs text-white/60"><span className="tabular-nums">{roi.deals_assumed}</span> deals{roi.payback_months_assumed != null ? ` · paid back in ${roi.payback_months_assumed} months of that` : ""}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-white/60">
          Every deal is worth about <b className="tabular-nums text-white/70">{usd(roi.monthly_per_deal)}</b> a month to you at these settings. At her goal of {r.goal} meetings a week she would add about <b className="tabular-nums text-white/70">{usd(roi.value_per_week_at_goal)}</b> of value a week.
          The assumed side is a guess until deals are signed, so judge her on the real side.
        </p>
      </Card>

      {/* settings + deals */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card label="Deal economics" title="Deal economics">
          <div className="grid grid-cols-2 gap-3">
            {econFields.map(([k, label, cur]) => (
              <label key={k} className="block text-xs text-white/55">{label}
                <input inputMode="decimal" value={edit[k] ?? cur} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                  className="mt-1 block min-h-[44px] w-full rounded-xl bg-white/[0.06] px-3 text-[15px] tabular-nums text-white ring-1 ring-white/10 focus:outline-none focus:ring-emerald-300" />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" disabled={busy || !Object.keys(edit).length} onClick={saveEcon} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>Save</button>
            <span className="text-xs text-white/55">Starting guesses. Put in your real cut when you have it.</span>
          </div>
        </Card>

        <Card label="Signed deals" title="Signed deals">
          {r.deals.length === 0 ? <p className="text-sm text-white/60">None yet. Add one when a meeting turns into a signed partner.</p> : (
            <ul className="divide-y divide-white/5">
              {r.deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0"><div className="truncate text-[15px] text-white">{d.company}</div><div className="text-xs text-white/60">{day(d.signed_on)}{d.monthly_cut != null ? ` · ${usd(d.monthly_cut)} a month` : " · default cut"}</div></div>
                  <button type="button" aria-label={sure === d.id ? `Confirm remove ${d.company}` : `Remove ${d.company}`} disabled={busy} onClick={() => ask(d.id, () => void run("rg_deal_delete", { p_id: d.id }, "Removed"))}
                    className={cn("grid h-11 min-w-[44px] shrink-0 place-items-center rounded-xl px-2 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300", sure === d.id ? "bg-rose-400/20 text-rose-100" : "text-white/55 hover:text-white")}>{sure === d.id ? "Confirm" : <Trash2 className="h-4 w-4" aria-hidden />}</button>
                </li>
              ))}
            </ul>
          )}
          <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!deal.company.trim()) return;
            const cut = deal.cut.trim() === "" ? null : Number(deal.cut);
            if (cut != null && !Number.isFinite(cut)) { toast.error("Monthly cut must be a number"); return; }
            void run("rg_deal_add", { p_company: deal.company, p_monthly_cut: cut }, "Deal added").then(() => setDeal({ company: "", cut: "" })); }}>
            <input aria-label="Company" placeholder="Company" value={deal.company} onChange={(e) => setDeal({ ...deal, company: e.target.value })}
              className="min-h-[44px] min-w-[140px] flex-1 rounded-xl bg-white/[0.06] px-3 text-[15px] text-white ring-1 ring-white/10 focus:outline-none focus:ring-emerald-300" />
            <input aria-label="Your monthly cut in dollars" inputMode="decimal" placeholder="$ a month (optional)" value={deal.cut} onChange={(e) => setDeal({ ...deal, cut: e.target.value })}
              className="min-h-[44px] w-[150px] rounded-xl bg-white/[0.06] px-3 text-[15px] tabular-nums text-white ring-1 ring-white/10 focus:outline-none focus:ring-emerald-300" />
            <button type="submit" disabled={busy} className={cn(btn, "inline-flex items-center gap-1.5 bg-emerald-400 text-black hover:bg-emerald-300")}><Plus className="h-4 w-4" aria-hidden />Add</button>
          </form>
        </Card>
      </div>

      {r.plans.length > 0 && (
        <Card label="Plan history" title="Plan history">
          <ul className="divide-y divide-white/5 text-sm">
            {r.plans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="whitespace-nowrap text-white/80">{day(p.started_on)} to {day(p.ends_on)} · target {p.target} a week</span>
                <span className="text-xs capitalize text-white/50">{p.status}{p.outcome ? ` · ${p.outcome}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
