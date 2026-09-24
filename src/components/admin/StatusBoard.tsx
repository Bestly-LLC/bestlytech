/**
 * Status: every watchdog and scheduled job in one place (admin_watchdogs()), plus the product
 * rows passed in as children. One card: the answer ("All 40 checks are working"), the product
 * rows, then anything failing with "Ask Scout to fix". Everything else sits behind "See all checks".
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, RefreshCw, Sparkles, XCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askScout } from "@/components/admin/scoutBus";
import { cn } from "@/lib/utils";
import { Disclosure, IconButton, LoadError, cardCls, divider, focusRing, hairline, inset, rowCls, text, tint } from "@/components/admin/ui";

type State = "ok" | "flaky" | "late" | "bad" | "new" | "off";
export type Check = {
  id: string; job?: string; name: string; group: string; schedule?: string; last_run: string | null;
  last_status?: string | null; detail?: string | null; recent_fails?: number; state: State;
};

const PROBLEM: State[] = ["bad", "late", "flaky"];
const DOT: Record<State, string> = {
  ok: "bg-[#30D158]", flaky: "bg-[#FF9F0A]", late: "bg-[#FF9F0A]", bad: "bg-[#FF453A]", new: "bg-white/25", off: "bg-white/15",
};
const WORD: Record<State, string> = {
  ok: "OK", flaky: "Failing sometimes", late: "Hasn't run on time", bad: "Last run failed", new: "Waiting for first run", off: "Turned off",
};

/** 12-hour clock, LA time: "just now", "12 min ago", "3:05 PM", "Sep 22, 3:05 PM". */
function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso), now = Date.now(), mins = Math.round((now - +d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
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
    <li className={rowCls}>
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[c.state])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn(text.title, "truncate")}>{c.name}</p>
        <p className={cn(text.detail, "truncate")} title={c.detail ?? undefined}>
          {c.state === "ok" ? `Ran ${when(c.last_run)}` : c.state === "new" || c.state === "off" ? WORD[c.state] : `${WORD[c.state]} · ran ${when(c.last_run)}`}
          {c.detail && c.state !== "ok" ? ` · ${c.detail}` : ""}
        </p>
      </div>
      <span className="sr-only">{WORD[c.state]}</span>
      {fix && (
        <button type="button" onClick={() => askFix(c)} aria-label={`Ask Scout to fix ${c.name}`}
          className={cn("inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-[13px] font-semibold text-white/90 transition-colors hover:bg-white/[0.14] sm:min-h-9", focusRing)}>
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
      <div className={cn(cardCls, "overflow-hidden")}>
        {/* Headline: one line that answers "is everything working?" */}
        <div className={cn("flex min-h-[52px] items-center justify-between gap-3 py-2", inset)}>
          {checks == null && !error ? (
            <span className={cn(text.detail, "inline-flex items-center gap-2 text-[15px]")}><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking…</span>
          ) : error && checks == null ? (
            <LoadError label="checks" onRetry={load} busy={busy} detail={error} />
          ) : problems.length === 0 ? (
            <p className={cn("inline-flex items-center gap-2 text-[15px] font-semibold", tint.green)}>
              <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden /> All {total} checks working
            </p>
          ) : (
            <p className={cn("inline-flex items-center gap-2 text-[15px] font-semibold", red ? tint.red : tint.orange)}>
              {red ? <XCircle className="h-5 w-5 shrink-0" aria-hidden /> : <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />}
              {problems.length} of {total} {problems.length === 1 ? "check needs" : "checks need"} you
            </p>
          )}
          <IconButton label="Check again" onClick={load} disabled={busy} className="-mr-2">
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden />
          </IconButton>
        </div>
        {/* Kept the last good list on a failed refresh; say so instead of going quiet. */}
        {error && checks != null && (
          <div className={cn("border-t py-2", hairline, inset)}><LoadError label="the latest checks" onRetry={load} busy={busy} detail={error} /></div>
        )}

        {children && <ul className={cn("border-t", hairline, divider)} aria-label="Products">{children}</ul>}

        {problems.length > 0 && (
          <ul className={cn("border-t", hairline, divider)} aria-label="Checks that need you">
            {problems.map((c) => <Row key={c.id} c={c} fix />)}
          </ul>
        )}

        {total > 0 && (
          <Disclosure open={open} onToggle={() => setOpen((v) => !v)} controls="all-checks">
            {open ? "Hide checks" : `See all ${total} checks`}
          </Disclosure>
        )}
      </div>

      {open && (
        <div id="all-checks" className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(20rem,100%),1fr))]">
          {groups.map(([g, list]) => {
            const bad = list.filter((c) => PROBLEM.includes(c.state)).length;
            return (
              <section key={g} className={cn(cardCls, "overflow-hidden")} aria-label={g}>
                <h3 className={cn("flex min-h-[44px] items-center justify-between border-b text-[13px] font-semibold uppercase tracking-[0.02em] text-white/60", hairline, inset)}>
                  {g}<span className={cn("normal-case tracking-normal", bad ? tint.orange : "text-white/45")}>{bad ? `${bad} need you` : `${list.length} OK`}</span>
                </h3>
                <ul className={divider}>
                  {list.map((c) => <Row key={c.id} c={c} fix={PROBLEM.includes(c.state)} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
