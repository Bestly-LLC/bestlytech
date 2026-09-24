/**
 * Status: every watchdog and scheduled job in one place (admin_watchdogs()), plus the product
 * chips passed in as children. Problems float to the top with an "Ask Scout to fix" button;
 * everything else sits behind "See all checks", grouped, each with a dot and its last run.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askScout } from "@/components/admin/scoutBus";
import { cn } from "@/lib/utils";

type State = "ok" | "flaky" | "late" | "bad" | "new" | "off";
export type Check = {
  id: string; job?: string; name: string; group: string; schedule?: string; last_run: string | null;
  last_status?: string | null; detail?: string | null; recent_fails?: number; state: State;
};

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80";
const PROBLEM: State[] = ["bad", "late", "flaky"];
const DOT: Record<State, string> = {
  ok: "bg-emerald-500", flaky: "bg-amber-400", late: "bg-amber-400", bad: "bg-red-500", new: "bg-white/25", off: "bg-white/15",
};
const WORD: Record<State, string> = {
  ok: "OK", flaky: "Failing sometimes", late: "Hasn't run on time", bad: "Last run failed", new: "Waiting for first run", off: "Turned off",
};

function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso), now = Date.now(), mins = Math.round((now - +d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  const sameDay = new Date(now).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) === d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });
  return sameDay ? t : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })}, ${t}`;
}

function askFix(c: Check) {
  askScout(`Fix this: "${c.name}" ${WORD[c.state].toLowerCase()}. Find out why, write the fix, and wait for my tap before running it.`, {
    about: [`Check: ${c.name}`, c.job ? `pg_cron job: ${c.job} (${c.schedule})` : `Service check: ${c.id}`,
      `State: ${c.state} · last run ${when(c.last_run)}${c.last_status ? ` (${c.last_status})` : ""}`,
      c.detail ? `Error: ${c.detail}` : null, c.recent_fails ? `Failed ${c.recent_fails} of its last 5 runs` : null].filter(Boolean).join("\n"),
  });
}

function Row({ c, fix }: { c: Check; fix?: boolean }) {
  return (
    <li className="flex min-h-[44px] items-center gap-3 py-2">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[c.state])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white/90">{c.name}</p>
        <p className="truncate text-xs text-white/55" title={c.detail ?? undefined}>
          {c.state === "ok" ? `Ran ${when(c.last_run)}` : c.state === "new" || c.state === "off" ? WORD[c.state] : `${WORD[c.state]} · last ran ${when(c.last_run)}`}
          {c.detail && c.state !== "ok" ? ` · ${c.detail}` : ""}
        </p>
      </div>
      <span className="sr-only">{WORD[c.state]}</span>
      {fix && (
        <button type="button" onClick={() => askFix(c)}
          className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-sm font-medium text-white/90 hover:bg-white/[0.14] transition-colors", focusRing)}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Ask Scout to fix
        </button>
      )}
    </li>
  );
}

export function StatusBoard({ children }: { children?: ReactNode }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    const { data, error: e } = await (supabase.rpc("admin_watchdogs" as never) as unknown as Promise<{ data: Check[] | null; error: { message: string } | null }>);
    setBusy(false);
    if (e) { setError(e.message); return; }
    setError(null); setChecks(data ?? []);
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  const problems = useMemo(() => (checks ?? []).filter((c) => PROBLEM.includes(c.state))
    .sort((a, b) => PROBLEM.indexOf(a.state) - PROBLEM.indexOf(b.state)), [checks]);
  const groups = useMemo(() => {
    const m = new Map<string, Check[]>();
    for (const c of checks ?? []) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [checks]);
  const total = checks?.length ?? 0;
  const red = problems.filter((c) => c.state === "bad").length;

  return (
    <div className="space-y-3">
      {/* Headline: one line that answers "is everything working?" */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {checks == null && !error ? (
          <span className="inline-flex h-9 items-center gap-2 text-sm text-white/60"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking…</span>
        ) : error ? (
          <button type="button" onClick={load} className={cn("inline-flex h-9 items-center gap-2 text-sm text-amber-300", focusRing)}>
            <AlertTriangle className="h-4 w-4" aria-hidden /> Couldn't load checks · Retry
          </button>
        ) : problems.length === 0 ? (
          <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-emerald-300">
            <CheckCircle2 className="h-5 w-5" aria-hidden /> All {total} checks are working
          </p>
        ) : (
          <p className={cn("inline-flex items-center gap-2 text-[15px] font-semibold", red ? "text-red-300" : "text-amber-300")}>
            {red ? <XCircle className="h-5 w-5" aria-hidden /> : <AlertTriangle className="h-5 w-5" aria-hidden />}
            {problems.length} of {total} {problems.length === 1 ? "check needs" : "checks need"} you
          </p>
        )}
        <button type="button" onClick={load} disabled={busy} aria-label="Check again"
          className={cn("inline-flex h-9 w-9 items-center justify-center rounded-full text-white/50 hover:bg-white/5 hover:text-white/80 disabled:opacity-50", focusRing)}>
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden />
        </button>
      </div>

      {children && <ul className="flex flex-wrap gap-2">{children}</ul>}

      {problems.length > 0 && (
        <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/10 bg-white/[0.03] px-4" aria-label="Checks that need you">
          {problems.map((c) => <Row key={c.id} c={c} fix />)}
        </ul>
      )}

      {total > 0 && (
        <div>
          <button type="button" aria-expanded={open} aria-controls="all-checks" onClick={() => setOpen((v) => !v)}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-md px-2 -ml-2 text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors", focusRing)}>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
            {open ? "Hide all checks" : `See all ${total} checks`}
          </button>
          {open && (
            <div id="all-checks" className="mt-2 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(20rem,100%),1fr))]">
              {groups.map(([g, list]) => {
                const bad = list.filter((c) => PROBLEM.includes(c.state)).length;
                return (
                  <section key={g} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 pb-2 pt-3" aria-label={g}>
                    <h3 className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-widest text-white/55">
                      {g}<span className={cn("normal-case tracking-normal", bad ? "text-amber-300" : "text-white/40")}>{bad ? `${bad} need you` : `${list.length} OK`}</span>
                    </h3>
                    <ul className="mt-1 divide-y divide-white/[0.06]">
                      {list.map((c) => <Row key={c.id} c={c} fix={PROBLEM.includes(c.state)} />)}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
