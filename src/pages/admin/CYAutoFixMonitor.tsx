import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/admin/PageHeader";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { DomainDeepDive, markDomainResolved, useCyLiveRefresh } from "@/components/admin/DomainDeepDive";
import {
  AlertTriangle, CheckCircle2, ExternalLink, Hand, Link2, Loader2, PanelRightOpen, RotateCcw, ShieldX, Sparkles, XCircle,
} from "lucide-react";

/*
 * Auto-Fix: stuck domains are handled by the cy-autofix function (every 15 min, or "Try again").
 * It loads the page in Chromium from Frankfurt, hands the banner to the AI and click-tests the fix.
 * This page only asks Jared for the one thing a robot can't do, as numbered steps.
 */

type Health = {
  in_progress: number;
  resolved_24h: number;
  patterns_serving: number;
  patterns_validated: number;
};

type Stuck = {
  id: number;
  domain: string;
  page_url: string | null;
  report_count: number;
  autofix_outcome: string | null;
  autofix_note: string | null;
  autofix_last_at: string | null;
};

const HUMAN_OUTCOMES = new Set(["blocked", "no_banner_seen", "ai_failed", "ai_wrong"]);

const siteUrl = (r: Stuck) => r.page_url || `https://${r.domain}`;
const siteHost = (r: Stuck) => { try { return new URL(siteUrl(r)).hostname.replace(/^www\./, ""); } catch { return r.domain; } };

const REPORT_STEP = (
  <>Tap <strong className="text-white">Cookie Yeti</strong>, then <strong className="text-white">Report a missed banner</strong>.</>
);

function guidance(r: Stuck): { title: string; steps: React.ReactNode[]; after: string } {
  const host = siteHost(r);
  switch (r.autofix_outcome) {
    case "blocked":
      return {
        title: "The site blocks our robot browser",
        steps: [<>Open <strong className="text-white">{host}</strong> on your phone or Mac.</>, REPORT_STEP],
        after: "Your report carries the real banner. The AI fixes and tests it from there.",
      };
    case "no_banner_seen":
      return {
        title: "No cookie banner showed up for us",
        steps: [
          <>Open <strong className="text-white">{host}</strong>. Is there a cookie banner?</>,
          <>Yes: tap <strong className="text-white">Cookie Yeti</strong>, then <strong className="text-white">Report a missed banner</strong>.</>,
          <>No: tap <strong className="text-white">No banner</strong> below.</>,
        ],
        after: "Either way you're done. A report goes straight to the AI.",
      };
    case "ai_wrong":
      return {
        title: "The AI's fix didn't close the banner",
        steps: [<>Open <strong className="text-white">{host}</strong> with Cookie Yeti on.</>, REPORT_STEP],
        after: "That gives the AI the exact banner you see. It retries and tests on its own.",
      };
    default:
      return {
        title: "The AI couldn't find the right button",
        steps: [<>Open <strong className="text-white">{host}</strong> with Cookie Yeti on.</>, REPORT_STEP],
        after: "That gives the AI the exact banner you see. It retries and tests on its own.",
      };
  }
}

const RESULT_TOAST: Record<string, { kind: "success" | "info" | "warning"; title: string }> = {
  fixed: { kind: "success", title: "Fixed and tested" },
  fixed_unverified: { kind: "success", title: "Fixed, new pattern is live" },
  wrong_site: { kind: "success", title: "Closed: not a real site" },
  blocked: { kind: "warning", title: "Still blocked, needs your report" },
  no_banner_seen: { kind: "info", title: "No banner found" },
  ai_failed: { kind: "warning", title: "AI still couldn't fix it" },
  ai_wrong: { kind: "warning", title: "AI's fix didn't work" },
};

async function runAutofix(domain: string, url?: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("cy-autofix", { body: { domain, ...(url ? { url } : {}) } });
  if (error || !data || (data as any).error) {
    toast.error(`Auto-fix didn't run for ${domain}`, { description: (data as any)?.error || error?.message || "No response" });
    return false;
  }
  const { outcome, note } = data as { outcome: string; note: string };
  const t = RESULT_TOAST[outcome] ?? { kind: "info" as const, title: outcome };
  toast[t.kind](`${domain}: ${t.title}`, { description: note });
  return true;
}

export default function CYAutoFixMonitor({ embedded = false }: { embedded?: boolean } = {}) {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [stuck, setStuck] = useState<Stuck[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null = probe failed (unknown); true/false = the render engine answered an authenticated ping.
  const [renderOnline, setRenderOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [linkFor, setLinkFor] = useState<Stuck | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadData = useCallback(async () => {
    const [h, s, render] = await Promise.all([
      supabase.from("v_cookieyeti_pipeline_health" as any).select("*").maybeSingle(),
      supabase
        .from("v_cookieyeti_needs_attention" as any)
        .select("id, domain, page_url, report_count, autofix_outcome, autofix_note, autofix_last_at")
        .order("report_count", { ascending: false })
        .limit(50),
      supabase.functions.invoke("cy-render-health", { method: "GET" }),
    ]);
    const err = h.error?.message || s.error?.message || null;
    setLoadError(err);
    if (!h.error) setHealth((h.data as unknown as Health) || null);
    if (!s.error) setStuck((s.data as unknown as Stuck[]) || []);
    setRenderOnline(render.error || !render.data ? null : !!((render.data as any).online ?? (render.data as any).configured));
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useCyLiveRefresh(["cookie_patterns", "missed_banner_reports"], loadData);

  const withBusy = async (domain: string, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [domain]: true }));
    try { await fn(); } finally {
      setBusy((b) => ({ ...b, [domain]: false }));
      loadData();
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-3xl" aria-busy="true">
        {!embedded && <div><Skeleton className="h-9 w-56" /><Skeleton className="h-4 w-80 mt-3" /></div>}
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }

  const yourTurn = stuck.filter((r) => HUMAN_OUTCOMES.has(r.autofix_outcome ?? ""));
  const fixing = stuck.filter((r) => !HUMAN_OUTCOMES.has(r.autofix_outcome ?? ""));
  const h = health;

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        embedded={embedded}
        title="Auto-Fix"
        description="Stuck sites get fixed on their own. You only see what a robot can't do."
      />

      {renderOnline === false && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3.5">
          <ShieldX className="h-5 w-5 text-red-300 flex-none mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium text-red-200">Robot browser offline</p>
            <p className="text-red-200/75 text-xs mt-0.5">
              bestly.tech/api/cy-render didn't answer, so fixes pause until it's back. Nothing for you to do; it retries every 15 minutes.
            </p>
          </div>
        </div>
      )}

      {/* One status line: what state are we in, and does it need Jared? */}
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3.5">
          <AlertTriangle className="h-5 w-5 text-red-300 flex-none" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-red-200">Couldn't load Auto-Fix</p>
            <p className="text-red-200/75 text-xs mt-0.5 break-words">{loadError}</p>
          </div>
          <Button size="sm" variant="outline" onClick={loadData} className="h-9 border-red-500/30 text-red-100 hover:bg-red-500/10">Retry</Button>
        </div>
      ) : (
        <div className={`rounded-2xl border px-4 py-4 ${yourTurn.length
          ? "border-amber-500/25 bg-amber-500/[0.06]"
          : fixing.length ? "border-sky-500/20 bg-sky-500/[0.05]" : "border-emerald-500/20 bg-emerald-500/[0.06]"}`}>
          <div className="flex items-center gap-3">
            {yourTurn.length ? (
              <Hand className="h-5 w-5 text-amber-300 flex-none" aria-hidden="true" />
            ) : fixing.length ? (
              <Sparkles className="h-5 w-5 text-sky-300 flex-none" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-300 flex-none" aria-hidden="true" />
            )}
            <p className={`text-[0.9375rem] font-semibold ${yourTurn.length ? "text-amber-100" : fixing.length ? "text-sky-100" : "text-emerald-100"}`}>
              {yourTurn.length
                ? `${yourTurn.length} site${yourTurn.length === 1 ? "" : "s"} need${yourTurn.length === 1 ? "s" : ""} a 30-second hand`
                : fixing.length
                  ? `Fixing ${fixing.length} stuck site${fixing.length === 1 ? "" : "s"} on its own`
                  : "All clear. Everything is fixing itself."}
            </p>
          </div>
          {h && (
            <p className="text-xs text-white/60 mt-2 pl-8">
              {h.resolved_24h ?? 0} fixed today · {h.in_progress ?? 0} in progress · {(h.patterns_serving ?? 0).toLocaleString()} patterns live · {h.patterns_validated ?? 0} click-tested
            </p>
          )}
        </div>
      )}

      {/* Your turn: numbered steps, one obvious button. */}
      {yourTurn.length > 0 && (
        <section aria-labelledby="your-turn" className="space-y-3">
          <h2 id="your-turn" className="text-sm font-medium text-white">Your turn</h2>
          {yourTurn.map((r) => {
            const g = guidance(r);
            const running = busy[r.domain];
            return (
              <article key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{r.domain}</p>
                    <p className="text-sm text-amber-200 mt-0.5">{g.title}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    <span className="text-xs text-white/55 tabular-nums">{r.report_count} report{r.report_count === 1 ? "" : "s"}</span>
                    <ActionMenu
                      label={`More for ${r.domain}`}
                      items={[
                        { label: "Banner is on another page…", icon: Link2, onSelect: () => { setLinkValue(""); setLinkFor(r); } },
                        { label: "Details and history", icon: PanelRightOpen, onSelect: () => { setSelectedDomain(r.domain); setDrawerOpen(true); } },
                      ]}
                    />
                  </div>
                </div>

                <ol className="mt-3 space-y-1.5">
                  {g.steps.map((step, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-white/75">
                      <span className="flex-none h-5 w-5 rounded-full bg-white/10 text-white/80 text-[0.6875rem] font-semibold grid place-items-center tabular-nums">{i + 1}</span>
                      <span className="pt-px">{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-white/55 mt-2">{g.after}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild size="sm" className="h-9">
                    <a href={siteUrl(r)} target="_blank" rel="noopener noreferrer">
                      Open {siteHost(r)} <ExternalLink className="h-3.5 w-3.5 ml-1.5" aria-hidden="true" />
                    </a>
                  </Button>
                  <Button
                    size="sm" variant="outline" className="h-9 border-white/15 text-white/80 hover:bg-white/5"
                    disabled={running}
                    onClick={() => withBusy(r.domain, async () => { if (await markDomainResolved(r.domain)) toast.message("It comes back only if someone reports it again."); })}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> No banner
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-9 text-white/70 hover:text-white hover:bg-white/5"
                    disabled={running}
                    onClick={() => withBusy(r.domain, () => runAutofix(r.domain))}
                  >
                    {running
                      ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" /> Checking, about a minute</>
                      : <><RotateCcw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Try again</>}
                  </Button>
                </div>
                {r.autofix_note && <p className="text-[0.6875rem] text-white/45 mt-3">Robot's note: {r.autofix_note}</p>}
              </article>
            );
          })}
        </section>
      )}

      {/* Fixing on its own: visible so nothing looks lost, no action required. */}
      {fixing.length > 0 && (
        <section aria-labelledby="fixing" className="rounded-2xl border border-white/10 bg-white/[0.02]">
          <div className="px-4 sm:px-5 pt-4 pb-2">
            <h2 id="fixing" className="text-sm font-medium text-white">Fixing on its own</h2>
            <p className="text-xs text-white/55 mt-0.5">One site every 15 minutes. Nothing for you to do.</p>
          </div>
          <ul>
            {fixing.map((r) => {
              const running = busy[r.domain] || r.autofix_outcome === "running";
              return (
                <li key={r.id} className="flex items-center gap-3 border-t border-white/[0.06] px-4 sm:px-5 py-2.5">
                  {running
                    ? <Loader2 className="h-4 w-4 text-sky-300 animate-spin flex-none" aria-hidden="true" />
                    : <Sparkles className="h-4 w-4 text-white/40 flex-none" aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate text-sm text-white/85">{r.domain}</span>
                  <span className="text-xs text-white/55">{running ? "Checking now" : "Queued"}</span>
                  <Button
                    size="sm" variant="ghost" className="h-9 text-white/70 hover:text-white hover:bg-white/5"
                    disabled={running}
                    onClick={() => withBusy(r.domain, () => runAutofix(r.domain))}
                  >
                    Run now
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Dialog open={!!linkFor} onOpenChange={(o) => { if (!o) setLinkFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Where does the banner show?</DialogTitle>
            <DialogDescription>
              Paste the page link for {linkFor?.domain}. The robot loads that page, the AI builds a fix, and it gets click-tested.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus inputMode="url" placeholder="https://…" value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            aria-label="Page link"
          />
          <DialogFooter>
            <Button
              disabled={!/^https?:\/\/\S+\.\S+/i.test(linkValue.trim()) || (linkFor ? busy[linkFor.domain] : false)}
              onClick={() => {
                const r = linkFor!; const url = linkValue.trim();
                setLinkFor(null);
                withBusy(r.domain, () => runAutofix(r.domain, url));
              }}
            >
              Fix from this page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DomainDeepDive domain={selectedDomain} open={drawerOpen} onOpenChange={setDrawerOpen} onRefresh={loadData} />
    </div>
  );
}
