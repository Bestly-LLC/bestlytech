/**
 * Call safety: what Call Guard lets through, for one seller. Sits on the RoofGuard Setup tab (Reese) and on /admin/maya (Maya).
 * Data: call_guard_report() (admin only). "Callable now" counts leads that pass every line-type and do-not-call check; the
 * time of day and the calling switch are separate, and calling stays off until a lawyer signs off. Plan: docs/call-guard-opusplan.md.
 * Numbers never split from their unit (non-breaking space), times are 12-hour, nothing is cut off with an ellipsis.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, PauseCircle, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const NB = " ";
type Seller = "roofguard" | "bestly";
type Side = { calling_enabled: boolean; total: number; callable: number; skipped: Record<string, number> };
type Report = { roofguard: Side; bestly: Side; selftest: { at: string; ok: boolean; checks: number; failures: string[] } | null };

/** Plain words for each reason the guard skips a lead. */
const WORDS: Record<string, string> = {
  mobile: "cell phones",
  unverified: "not checked yet",
  "voip-not-business-listed": "internet lines not listed by the business",
  "line-check-stale": "checked too long ago",
  dnc: "asked not to be called",
  unknown: "line type unknown",
};
const ORDER = ["mobile", "unverified", "voip-not-business-listed", "line-check-stale", "dnc", "unknown"];

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")}${NB}${n === 1 ? one : many}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s(AM|PM)$/, `${NB}$1`);

export function CallSafetyCard({ seller, who }: { seller: Seller; who: string }) {
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error } = await (supabase.rpc("call_guard_report" as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
    setBusy(false);
    if (error) { setErr("Couldn't load the call safety numbers. Try again in a minute."); return; }
    setErr(null);
    setRep(data as Report);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const side = rep?.[seller];
  const st = rep?.selftest ?? null;
  const rows = side ? [...ORDER, ...Object.keys(side.skipped).filter((k) => !ORDER.includes(k))].filter((k) => (side.skipped[k] ?? 0) > 0) : [];

  return (
    <section aria-labelledby={`callsafety-${seller}`} className="rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/10 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300" aria-hidden><ShieldCheck className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h3 id={`callsafety-${seller}`} className="text-[15px] font-semibold text-white">Call safety</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-white/60">Call Guard checks every number before {who} can dial it.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} aria-label="Refresh call safety"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white/70 ring-1 ring-white/15 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50 motion-reduce:transition-none">
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {err && <p role="alert" className="mt-3 rounded-2xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/40">{err}</p>}
      {!side && !err && <p className="mt-4 text-sm text-white/60">Loading</p>}

      {side && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums text-white">{side.callable.toLocaleString("en-US")}</span>
            <span className="text-sm text-white/70">callable now, out of {plural(side.total, "lead", "leads")} with a phone number</span>
          </div>
          <p className={cn("flex items-start gap-2 text-sm", side.calling_enabled ? "text-amber-200" : "text-white/70")}>
            {side.calling_enabled ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <span>{side.calling_enabled ? `Calling is on for ${who}.` : `Calling is off, so nothing dials. These are the leads ${who} could call once it is on.`}</span>
          </p>

          {rows.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-white/50">Skipped</h4>
              <ul className="mt-1 divide-y divide-white/[0.08]">
                {rows.map((k) => (
                  <li key={k} className="flex min-h-[44px] items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 text-white/80 [overflow-wrap:anywhere]">{WORDS[k] ?? k}</span>
                    <span className="shrink-0 tabular-nums text-white">{(side.skipped[k] ?? 0).toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-start gap-2 border-t border-white/[0.08] pt-3 text-sm">
            {!st ? <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-white/50" aria-hidden />
              : st.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
              : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden />}
            <div className="min-w-0 text-white/80">
              {!st ? "Last self-test: not run yet. It runs every night at about 2:10 AM Pacific."
                : st.ok ? `Last self-test: passed (${plural(st.checks, "check", "checks")}), ${when(st.at)}.`
                : `Last self-test: failed, ${when(st.at)}. Calling was switched off.`}
              {st && !st.ok && st.failures.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-200">
                  {st.failures.slice(0, 5).map((f, i) => <li key={i} className="[overflow-wrap:anywhere]">{f}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
