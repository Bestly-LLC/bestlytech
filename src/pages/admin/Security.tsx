import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { CopyButton, CopyText } from "@/components/CopyText";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { askScout } from "@/components/admin/scoutBus";
import { SecurityTokensCard } from "./SecurityTokensCard";
import { ComplianceTab } from "./ComplianceTab";
import { Binoculars } from "lucide-react";
import { pollInterval } from "@/lib/polling";
import {
  countOpen, fetchFindings, fetchLog, fetchRuns, findingOwner, liveHeadline, setFindingStatus, subscribeSecurity,
  type SecurityFinding, type SecurityLogRow, type SecurityRun,
} from "@/services/securityAuditApi";

/**
 * Security — what the nightly 1:00 AM audit found, every run it made, and an append-only trail
 * of everything that changed. The audit only looks; Ares's Auto-Fixer then fixes what it safely
 * can within the hour. Counts here are live from the findings table (realtime), not the
 * snapshot the last run took, so a fix shows up the moment it lands.
 */

const LA_TZ = "America/Los_Angeles";
const fmt = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) =>
  iso ? new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, ...opts }).format(new Date(iso)) : "—";

function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SEV = {
  red: { label: "Red", chip: "bg-red-500/10 text-red-300 border-red-500/25", icon: XCircle, text: "text-red-300" },
  yellow: { label: "Yellow", chip: "bg-amber-500/10 text-amber-300 border-amber-500/25", icon: AlertTriangle, text: "text-amber-300" },
} as const;

const RUN_TONE: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  yellow: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  red: "bg-red-500/10 text-red-300 border-red-500/25",
  failed: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  running: "bg-white/[0.06] text-white/70 border-white/10",
};

const ACTION_LABEL: Record<string, string> = {
  run_started: "Run started",
  run_finished: "Run finished",
  opened: "Found",
  reopened: "Came back",
  worsened: "Got worse",
  fixed: "Fixed (check passed)",
  marked_fixed: "Marked fixed",
  dismissed: "Dismissed",
};

const pill = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80";

/** Everything Scout needs to actually fix it, not just be told about it. */
function findingContext(f: SecurityFinding) {
  return [
    `${f.severity.toUpperCase()}: ${f.title}`,
    `asset: ${f.asset} · layer: ${f.layer} · check: ${f.key}`,
    `open ${f.nights_open} night${f.nights_open === 1 ? "" : "s"}`,
    f.detail ? `\ndetail:\n${f.detail}` : "",
    f.proposed_fix ? `\nproposed fix:\n${f.proposed_fix}` : "",
  ].filter(Boolean).join("\n");
}

/** A self-contained prompt to paste into Claude (desktop or Code) to fix one or more findings. */
function fixPrompt(fs: SecurityFinding[]) {
  const many = fs.length > 1;
  return [
    many
      ? `Fix these ${fs.length} open security findings from the Bestly nightly audit (bestly.tech/admin/security).`
      : "Fix this open security finding from the Bestly nightly audit (bestly.tech/admin/security).",
    "",
    "How to work:",
    "- Read bestly_memory first (Supabase project rcqfqhguwpmaarseifqg; start with house/security-audit and security/conventions).",
    "- Fix it for real, then verify from the outside (headers with curl -I, DNS with dig, advisors with get_advisors).",
    "- Never break a live site: test what a change touches before shipping it. Secrets go only to Supabase Vault, never into code or chat.",
    "- If a step needs a decision or a login only I have, do everything around it and tell me the one step in plain words.",
    "- When one is fixed, run: select security_finding_set_status('<id>', 'fixed', '<what you did>');",
    "",
    ...fs.map((f) => `id ${f.id}\n${findingContext(f)}`).join("\n\n---\n\n").split("\n"),
  ].join("\n");
}

function FindingRow({ f, onChange }: { f: SecurityFinding; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sev = SEV[f.severity];
  const Icon = sev.icon;

  const act = async (status: "fixed" | "dismissed" | "open") => {
    let note: string | undefined;
    if (status === "dismissed") {
      const r = window.prompt("Why is this OK to ignore? (kept in the audit trail)");
      if (r === null) return;
      note = r.trim() || "Dismissed without a reason";
    }
    setBusy(true);
    try {
      await setFindingStatus(f.id, status, note);
      toast.success(status === "dismissed" ? "Dismissed. Logged in the trail." : status === "fixed" ? "Marked fixed. Tonight's run will confirm." : "Reopened.");
      onChange();
    } catch (e) {
      toast.error((e as Error).message || "That didn't go through");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-4 py-4 sm:px-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn("flex w-full items-start gap-3 text-left", focusRing)}
      >
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", sev.text)} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-medium text-white">{f.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/55">
            {f.status === "open" && (
              findingOwner(f) === "you"
                ? <span className={cn(pill, "border-amber-500/25 bg-amber-500/10 text-amber-300")}>Needs you</span>
                : <span className={cn(pill, "border-white/10 bg-white/[0.05] text-white/70")}>Ares has it</span>
            )}
            <span>
              {f.asset} · {f.layer} · <span className="whitespace-nowrap">{f.status === "open" ? `open ${f.nights_open} ${f.nights_open === 1 ? "night" : "nights"}` : `${f.status} ${ago(f.resolved_at)}`}</span>
            </span>
          </span>
        </span>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-white/40 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {/* The proposed fix used to be a command to copy and run yourself. One tap hands
          the whole finding to Scout instead, which is the point of having Scout. */}
      {f.status === "open" && (
        <div className="mt-2 pl-8">
          <button
            type="button"
            onClick={() => askScout(`Fix this security finding for me.`, { about: findingContext(f) })}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-[13px] font-medium text-white hover:bg-white/[0.14]", focusRing)}
          >
            <Binoculars className="h-4 w-4" /> Scout fixes it
          </button>
          <CopyButton text={fixPrompt([f])} label="Copy fix prompt"
            className={cn("ml-2 inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-white/75 hover:bg-white/[0.06]", focusRing)} />
        </div>
      )}
      {open && (
        <div className="mt-3 space-y-3 pl-8">
          {f.status === "open" && f.autofix?.reason && (
            <p className="text-sm text-white/75"><span className="font-medium text-white">{findingOwner(f) === "you" ? "What Ares needs from you: " : "Ares: "}</span>{f.autofix.reason}</p>
          )}
          {f.detail && <p className="text-sm text-white/75 whitespace-pre-wrap">{f.detail}</p>}
          {f.proposed_fix && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-white/45">Proposed fix</p>
              <CopyText text={f.proposed_fix} />
            </div>
          )}
          {f.dismissed_reason && <p className="text-sm text-white/55">Dismissed: {f.dismissed_reason}</p>}
          <p className="text-xs text-white/40">First seen {fmt(f.first_seen)} · last seen {fmt(f.last_seen)} · check <code>{f.key}</code></p>
          <div className="flex flex-wrap gap-2">
            {f.status === "open" ? (
              <>
                <button type="button" disabled={busy} onClick={() => act("fixed")} className={cn("h-9 rounded-full bg-white/[0.08] px-3.5 text-[13px] font-medium text-white hover:bg-white/[0.14] disabled:opacity-60", focusRing)}>I fixed it</button>
                <button type="button" disabled={busy} onClick={() => act("dismissed")} className={cn("h-9 rounded-full px-3.5 text-[13px] font-medium text-white/70 hover:bg-white/[0.06] disabled:opacity-60", focusRing)}>Dismiss</button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => act("open")} className={cn("h-9 rounded-full bg-white/[0.08] px-3.5 text-[13px] font-medium text-white hover:bg-white/[0.14] disabled:opacity-60", focusRing)}>Reopen</button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function logText(r: SecurityLogRow): string {
  if (r.action === "run_finished" && r.after) {
    const a = r.after as Record<string, number | string>;
    return `${String(a.status).toUpperCase()} · ${a.checks} checks · ${a.new} new · ${a.fixed} fixed · ${a.open_red} red / ${a.open_yellow} yellow open`;
  }
  const title = (r.after as Record<string, string> | null)?.title;
  return [title ?? r.finding_key, r.asset && !title?.includes(r.asset) ? r.asset : null, r.note].filter(Boolean).join(" · ");
}

export default function Security() {
  const [runs, setRuns] = useState<SecurityRun[] | null>(null);
  const [findings, setFindings] = useState<SecurityFinding[] | null>(null);
  const [log, setLog] = useState<SecurityLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, f, l] = await Promise.all([fetchRuns(), fetchFindings(), fetchLog()]);
      setRuns(r); setFindings(f); setLog(l); setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Live: realtime on findings + runs, with a slow poll as the fallback.
  useEffect(() => {
    load();
    const stop = subscribeSecurity(load, "security-page");
    const iv = setInterval(() => { if (!document.hidden) load(); }, pollInterval(60_000));
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stop(); clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const refresh = async () => { setLoading(true); try { await load(); } finally { setLoading(false); } };

  const latest = runs?.[0] ?? null;
  const live = useMemo(() => countOpen(findings ?? []), [findings]);
  const head = liveHeadline(latest, live);
  // Needs-you first, then red before yellow, then longest open.
  const open = useMemo(() => (findings ?? []).filter((f) => f.status === "open")
    .sort((a, b) => {
      const oa = findingOwner(a) === "you" ? 0 : 1, ob = findingOwner(b) === "you" ? 0 : 1;
      if (oa !== ob) return oa - ob;
      if (a.severity !== b.severity) return a.severity === "red" ? -1 : 1;
      return b.nights_open - a.nights_open;
    }), [findings]);
  const closed = useMemo(() => (findings ?? []).filter((f) => f.status !== "open"), [findings]);
  const mine = useMemo(() => open.filter((f) => findingOwner(f) === "you"), [open]);
  // What changed since the run's snapshot, so its summary can't read as current.
  const closedSinceRun = useMemo(() => latest
    ? closed.filter((f) => f.resolved_at && new Date(f.resolved_at) > new Date(latest.started_at)).length : 0, [closed, latest]);

  const HeadIcon = head.tone === "ok" ? CheckCircle2 : head.tone === "bad" ? XCircle : AlertTriangle;
  const headText = head.tone === "ok" ? "text-emerald-300" : head.tone === "bad" ? "text-red-300" : "text-amber-300";

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-8">
      <PageHeader
        title="Security"
        description="Nightly audit at 1:00 AM Pacific. Ares fixes what he safely can within the hour; only what needs you stays here."
        actions={
          <div className="flex items-center gap-2">
          <span className="mr-1 inline-flex items-center gap-1.5 text-xs text-white/50">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden /> Live
          </span>
          <button type="button" onClick={refresh} disabled={loading} className={cn("inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-[13px] font-medium text-white hover:bg-white/[0.14] disabled:opacity-60", focusRing)}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden /> Refresh
          </button>
          </div>
        }
      />

      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden /> Couldn't load the audit: {error}
        </p>
      )}

      {/* Answer first */}
      {!runs ? (
        <Skeleton className="h-24 w-full rounded-2xl bg-white/[0.05]" />
      ) : (
        <section className="rounded-2xl border border-white/[0.06] px-4 py-5 sm:px-5">
          <div className="flex items-start gap-3">
            <HeadIcon className={cn("h-6 w-6 shrink-0", headText)} aria-hidden />
            <div className="min-w-0">
              <p className={cn("text-lg font-semibold", headText)}>
                {live.red > 0
                  ? `${live.red} red ${live.red === 1 ? "finding needs" : "findings need"} you`
                  : live.needsYou > 0
                    ? `${live.needsYou} ${live.needsYou === 1 ? "thing needs" : "things need"} you`
                    : head.tone === "warn" ? head.word
                    : live.withAres > 0 ? "Nothing needs you" : "All clear"}
              </p>
              <p className="mt-1 text-sm text-white/60">
                {live.withAres > 0 && <><span className="whitespace-nowrap">Ares has {live.withAres}</span> · </>}
                {latest ? (
                  <>Last run <span className="whitespace-nowrap">{fmt(latest.started_at)}</span> ({ago(latest.started_at)}) · <span className="whitespace-nowrap">{latest.checks_total} checks</span>
                    {closedSinceRun > 0 && <> · <span className="whitespace-nowrap text-emerald-300">{closedSinceRun} fixed since</span></>}</>
                ) : "No run yet."}
              </p>

              {/* The run's summary is a snapshot from 1 AM. Tucked away so it can't pass for current. */}
              {latest?.summary && (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}
                    className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 -ml-2 text-sm text-white/60 hover:bg-white/5 hover:text-white", focusRing)}>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", showNotes && "rotate-180")} aria-hidden />
                    What the {fmt(latest.started_at, { hour: "numeric", minute: "2-digit" })} run said
                  </button>
                  {showNotes && (
                    <p className="mt-1 text-sm text-white/70">
                      {latest.summary}
                      {closedSinceRun > 0 && <span className="mt-2 block text-white/50">{closedSinceRun} of these {closedSinceRun === 1 ? "has" : "have"} been fixed since.</span>}
                    </p>
                  )}
                </div>
              )}

              {/* Only what genuinely needs a person goes to Scout; what Ares holds stays with Ares. */}
              {mine.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      askScout(
                        mine.length === 1
                          ? "Help me close this security finding. Do everything you can, and tell me the one step only I can do."
                          : `Help me close these ${mine.length} security findings. Do everything you can, and tell me the one step only I can do for each.`,
                        { about: mine.map(findingContext).join("\n\n---\n\n") },
                      )
                    }
                    className={cn("inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90 active:scale-[0.97]", focusRing)}
                  >
                    <Binoculars className="h-4 w-4" />
                    {mine.length === 1 ? "Scout helps with this one" : `Scout helps with these ${mine.length}`}
                  </button>
                  <CopyButton text={fixPrompt(mine)} label={mine.length === 1 ? "Copy fix prompt" : `Copy fix prompt for ${mine.length}`}
                    className={cn("inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white/80 hover:bg-white/[0.08]", focusRing)} />
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">Open{open.length ? ` (${open.length})` : ""}</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="trail">Audit trail</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="mt-4 space-y-4">
          {!findings ? (
            <Skeleton className="h-40 w-full rounded-2xl bg-white/[0.05]" />
          ) : open.length === 0 ? (
            <p className="flex items-center gap-2.5 rounded-2xl border border-white/[0.06] px-4 py-4 text-[0.9375rem] text-white/80">
              <ShieldCheck className="h-5 w-5 text-emerald-300" aria-hidden /> Nothing open.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06]">
              {open.map((f) => <FindingRow key={f.id} f={f} onChange={load} />)}
            </ul>
          )}
          {closed.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed} className={cn("inline-flex h-9 items-center gap-1.5 rounded-md px-2 -ml-2 text-sm text-white/70 hover:text-white hover:bg-white/5", focusRing)}>
                <ChevronDown className={cn("h-4 w-4 transition-transform", showClosed && "rotate-180")} aria-hidden />
                {showClosed ? "Hide" : "Show"} fixed and dismissed ({closed.length})
              </button>
              {showClosed && (
                <ul className="mt-2 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06] opacity-80">
                  {closed.map((f) => <FindingRow key={f.id} f={f} onChange={load} />)}
                </ul>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          {!runs ? (
            <Skeleton className="h-40 w-full rounded-2xl bg-white/[0.05]" />
          ) : runs.length === 0 ? (
            <p className="text-sm text-white/60">No runs yet.</p>
          ) : (
            <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06]">
              {runs.map((r) => {
                const mins = r.finished_at ? Math.max(1, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 60_000)) : null;
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
                    <span className={cn(pill, RUN_TONE[r.status])}>{r.status}</span>
                    <span className="text-sm text-white">{fmt(r.started_at, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    <span className="text-sm text-white/55 tabular-nums">
                      {r.checks_passed}/{r.checks_total} passed · {r.new_findings} new · {r.fixed_findings} fixed{mins ? ` · ${mins} min` : ""}{r.trigger === "manual" ? " · manual" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="trail" className="mt-4">
          <p className="mb-3 flex items-center gap-2 text-xs text-white/50"><Clock3 className="h-3.5 w-3.5" aria-hidden /> Append-only. Rows here can't be edited or deleted, by anyone.</p>
          {!log ? (
            <Skeleton className="h-40 w-full rounded-2xl bg-white/[0.05]" />
          ) : (
            <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06]">
              {log.map((r) => (
                <li key={r.id} className="grid grid-cols-[auto_1fr] gap-x-3 px-4 py-2.5 sm:px-5">
                  <span className="text-xs text-white/45 tabular-nums pt-0.5 whitespace-nowrap">{fmt(r.at)}</span>
                  <span className="min-w-0 text-sm">
                    <span className="font-medium text-white">{ACTION_LABEL[r.action] ?? r.action}</span>
                    <span className="text-white/40"> · {r.actor === "audit" ? "nightly audit" : r.actor === "jared" ? "Jared" : "Scout"}</span>
                    <span className="block truncate text-white/60" title={logText(r)}>{logText(r)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="compliance" className="mt-4">
          <ComplianceTab />
        </TabsContent>
      </Tabs>

      <SecurityTokensCard />
    </div>
  );
}
