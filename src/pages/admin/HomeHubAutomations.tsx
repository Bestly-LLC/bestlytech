import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Panel, copyText } from "@/components/admin/homeHub/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Lines } from "@/components/Lines";
import { supabase } from "@/integrations/supabase/client";
import { pollInterval } from "@/lib/polling";
import {
  Wand2, CheckCircle2, AlertTriangle, XCircle, Copy, ChevronDown, Send, Undo2, Trash2, Pencil, RotateCcw, Rocket, Code2, Loader2,
} from "lucide-react";

/* Automation Maker: Jared types what should happen, Tinker (Home Automation Engineer) drafts it, he taps Install.
   Everything goes through the ha-automator edge function; rows come from ha_automations (contract: docs/ha-automator-opusplan.md). */

type Status = "drafting" | "preview" | "installing" | "installed" | "failed" | "handoff" | "undoing" | "undone" | "discarded";

type AutomationRow = {
  id: string;
  created_at: string;
  updated_at: string;
  request: string;
  feedback: string | null;
  kind: "automation" | "package" | "cannot" | null;
  status: Status;
  title: string | null;
  summary: unknown;
  assumptions: unknown;
  risky: boolean | null;
  risk_reason: string | null;
  yaml: string | null;
  enabled: boolean | null;
  error: string | null;
  handoff_prompt: string | null;
  installed_at: string | null;
};

type Op = "generate" | "revise" | "install" | "undo" | "toggle" | "discard" | "handoff";

const EXAMPLES: { label: string; request: string }[] = [
  { label: "Kitchen lights after bed", request: "When I get out of bed after 7 AM, turn on the kitchen lights" },
  { label: "Dyson when air is bad", request: "If the Dyson air quality is bad, turn the Dyson on" },
  { label: "TV strip off with projector", request: "Turn the TV backlight strip off when the projector turns on" },
];

const DRAFT_STEPS = ["Reading your home", "Writing the automation", "Checking it"];
const INSTALL_STEPS = ["Sending it to Home Assistant", "Letting Home Assistant check it"];
const UNDO_STEPS = ["Taking it back out of Home Assistant", "Putting things back how they were"];

const STATUS_LABEL: Record<Status, string> = {
  drafting: "Writing it",
  preview: "Ready to look at",
  installing: "Installing",
  installed: "Installed",
  failed: "Did not work",
  handoff: "With the Code Worker",
  undoing: "Undoing",
  undone: "Undone",
  discarded: "Discarded",
};

const BUSY_STATUSES: Status[] = ["drafting", "installing", "undoing"];

/* ---------- helpers ---------- */

const strings = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((s) => s.trim());
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
};

/** "9:42 PM" today, "Oct 19, 9:42 PM" before. */
function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

/** Plain-words error from invoke(): the function's own error text wins over the generic transport message. */
async function errorText(error: unknown, data: unknown): Promise<string> {
  const fromData = (data as { error?: unknown } | null)?.error;
  if (typeof fromData === "string" && fromData) return fromData;
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (typeof body?.error === "string" && body.error) return body.error;
    } catch { /* not JSON */ }
  }
  const msg = (error as { message?: string } | null)?.message ?? "";
  if (/failed to send|fetch|network/i.test(msg)) return "Could not reach the automation maker. Check your connection and try again.";
  if (/not found|404/i.test(msg)) return "The automation maker is not switched on yet. It will work once the backend is deployed.";
  return msg || "Something went wrong. Try again in a minute.";
}

async function callMaker(body: { op: Op } & Record<string, unknown>): Promise<{ ok: boolean; row?: AutomationRow; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("ha-automator", { body });
    if (error || (data as { ok?: boolean } | null)?.ok === false) return { ok: false, error: await errorText(error, data) };
    return { ok: true, row: (data as { row?: AutomationRow } | null)?.row };
  } catch (e) {
    return { ok: false, error: await errorText(e, null) };
  }
}

/* ---------- Tinker's working line ---------- */

/** A soft glowing orb plus one line that rotates through the real steps. The glow is a feathered radial gradient;
 *  under reduced motion it holds still and the line simply changes. */
function TinkerWorking({ steps, label = "Tinker" }: { steps: string[]; label?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % steps.length), 2800);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="flex items-center gap-3 min-h-[44px]" role="status" aria-live="polite">
      <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden>
        <span className="absolute -inset-3 rounded-full bg-[radial-gradient(closest-side,rgba(251,191,36,0.45),rgba(251,191,36,0.12)_55%,transparent)] blur-md motion-safe:animate-pulse" />
        <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-300/90 to-orange-500/80 shadow-[0_0_18px_rgba(251,191,36,0.35)]">
          <Wand2 className="h-3.5 w-3.5 text-black/75" />
        </span>
      </span>
      <p className="text-sm text-white/85 min-w-0">
        <span className="text-white/60">{label}: </span>
        <span key={i} className="inline-block motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">{steps[i]}</span>
      </p>
    </div>
  );
}

/* ---------- small pieces ---------- */

function StatusPill({ status }: { status: Status }) {
  const tone: Record<Status, string> = {
    drafting: "text-amber-200 bg-amber-400/10 border-amber-400/25",
    preview: "text-sky-200 bg-sky-400/10 border-sky-400/25",
    installing: "text-amber-200 bg-amber-400/10 border-amber-400/25",
    installed: "text-green-300 bg-green-500/10 border-green-500/25",
    failed: "text-red-300 bg-red-500/10 border-red-500/25",
    handoff: "text-violet-200 bg-violet-400/10 border-violet-400/25",
    undoing: "text-amber-200 bg-amber-400/10 border-amber-400/25",
    undone: "text-white/60 bg-white/[0.04] border-white/10",
    discarded: "text-white/60 bg-white/[0.04] border-white/10",
  };
  const Icon = status === "installed" ? CheckCircle2 : status === "failed" ? XCircle : BUSY_STATUSES.includes(status) ? Loader2 : null;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${tone[status]}`}>
      {Icon && <Icon className={`h-3.5 w-3.5 ${Icon === Loader2 ? "motion-safe:animate-spin" : ""}`} aria-hidden />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function Banner({ tone, title, children }: { tone: "amber" | "red"; title: string; children: ReactNode }) {
  const c = tone === "amber" ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-100" : "border-red-500/30 bg-red-500/[0.07] text-red-100";
  return (
    <div role={tone === "red" ? "alert" : undefined} className={`flex gap-3 rounded-xl border px-3.5 py-3 text-sm ${c}`}>
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 opacity-90"><Lines>{children as string}</Lines></p>
      </div>
    </div>
  );
}

function YamlDisclosure({ yaml }: { yaml: string }) {
  return (
    <details className="group rounded-xl border border-white/[0.08] bg-black/20">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm text-white/80 hover:text-white [&::-webkit-details-marker]:hidden">
        <span>Show the YAML</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-white/60 motion-safe:transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-white/[0.06] p-3">
        <pre className="max-h-80 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-xs leading-relaxed text-white/85 whitespace-pre">{yaml}</pre>
        <Button type="button" variant="outline" onClick={() => copyText(yaml, "YAML copied")} className="mt-3 h-11 border-white/15 bg-transparent text-white/85 hover:bg-white/5 hover:text-white">
          <Copy aria-hidden /> Copy YAML
        </Button>
      </div>
    </details>
  );
}

/* ---------- one automation card ---------- */

function AutomationCard({
  row, busyOp, error, onAct,
}: {
  row: AutomationRow;
  busyOp: Op | null;
  error: string | null;
  onAct: (op: Op, extra?: Record<string, unknown>) => void;
}) {
  const [changing, setChanging] = useState(false);
  const [feedback, setFeedback] = useState("");
  const summary = strings(row.summary);
  const assumptions = strings(row.assumptions);
  const muted = row.status === "undone" || row.status === "discarded";
  const working = BUSY_STATUSES.includes(row.status);
  const busy = busyOp !== null;
  const steps = row.status === "installing" ? INSTALL_STEPS : row.status === "undoing" ? UNDO_STEPS : DRAFT_STEPS;
  const title = row.title?.trim() || (working ? "Working on it" : "Untitled automation");

  const btnOutline = "h-11 border-white/15 bg-transparent text-white/85 hover:bg-white/5 hover:text-white";

  return (
    <article
      aria-label={title}
      className={`relative overflow-hidden rounded-2xl border p-4 sm:p-6 ${muted ? "border-white/[0.05] bg-white/[0.015] opacity-80" : "border-white/[0.06] bg-white/[0.03]"}`}
    >
      {row.status === "drafting" && (
        <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(251,191,36,0.14),transparent)] blur-2xl motion-safe:animate-pulse" />
      )}
      <div className="relative space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            <h3 className="text-base font-semibold leading-snug text-white">{title}</h3>
            <p className="mt-1 text-xs text-white/60"><span className="whitespace-nowrap">{when(row.created_at)}</span></p>
          </div>
          <StatusPill status={row.status} />
        </header>

        <p className="text-sm text-white/60">
          <span className="text-white/60">You asked: </span><span className="text-white/80">{row.request}</span>
        </p>

        {working && <TinkerWorking steps={steps} />}

        {summary.length > 0 && !working && (
          <ul className="space-y-1.5 rounded-xl bg-white/[0.03] px-3.5 py-3">
            {summary.map((s, i) => (
              <li key={i} className="text-sm text-white/90"><Lines>{s}</Lines></li>
            ))}
          </ul>
        )}

        {assumptions.length > 0 && !working && !muted && (
          <div>
            <p className="text-xs uppercase tracking-wide text-white/60 mb-1.5">Tinker assumed</p>
            <ul className="space-y-1">
              {assumptions.map((a, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-white/75">
                  <span aria-hidden className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-white/40" />
                  <span className="min-w-0"><Lines>{a}</Lines></span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {row.risky && !muted && (
          <Banner tone="amber" title="Worth a careful look">
            {row.risk_reason?.trim() || "This one touches something that matters, like a lock, a door, the heat or a sound at night."}
          </Banner>
        )}

        {row.status === "failed" && (
          <Banner tone="red" title="This did not work">
            {row.error?.trim() || "Home Assistant did not accept it, and there was no more detail."}
          </Banner>
        )}

        {row.yaml && !working && <YamlDisclosure yaml={row.yaml} />}

        {error && (
          <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3.5 py-3 text-sm text-red-200"><Lines>{error}</Lines></p>
        )}

        {/* Buttons by status */}
        {row.status === "preview" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => onAct("install")} disabled={busy} className="h-11 px-5 motion-safe:active:scale-[0.97] motion-safe:transition-transform">
                {busyOp === "install" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Rocket aria-hidden />} Install
              </Button>
              <Button type="button" variant="outline" onClick={() => setChanging((v) => !v)} disabled={busy} aria-expanded={changing} className={btnOutline}>
                <Pencil aria-hidden /> Change it
              </Button>
              <Button type="button" variant="ghost" onClick={() => onAct("discard")} disabled={busy} className="h-11 text-white/70 hover:bg-white/5 hover:text-white">
                <Trash2 aria-hidden /> Discard
              </Button>
            </div>
            {changing && (
              <form
                className="space-y-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!feedback.trim() || busy) return;
                  onAct("revise", { feedback: feedback.trim() });
                  setFeedback("");
                  setChanging(false);
                }}
              >
                <label htmlFor={`fb-${row.id}`} className="block text-sm text-white/80">What should be different?</label>
                <textarea
                  id={`fb-${row.id}`}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={3}
                  placeholder="Only after sunset, and use the dimmer lamp"
                  className="w-full resize-y rounded-xl border border-white/[0.1] bg-black/30 px-3.5 py-3 text-base text-white placeholder:text-white/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                />
                <Button type="submit" disabled={!feedback.trim() || busy} className="h-11 px-5">
                  {busyOp === "revise" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Send aria-hidden />} Send it to Tinker
                </Button>
              </form>
            )}
          </div>
        )}

        {row.status === "installed" && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex min-h-[44px] items-center gap-3 text-sm text-white/85">
              <Switch
                checked={row.enabled !== false}
                disabled={busy}
                aria-label={row.enabled !== false ? "Turn this automation off" : "Turn this automation on"}
                onCheckedChange={(on) => onAct("toggle", { enabled: on })}
              />
              <span className="whitespace-nowrap w-6">{row.enabled !== false ? "On" : "Off"}</span>
            </label>
            <Button type="button" variant="outline" onClick={() => onAct("undo")} disabled={busy} className={btnOutline}>
              {busyOp === "undo" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Undo2 aria-hidden />} Undo
            </Button>
          </div>
        )}

        {row.status === "failed" && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => onAct("generate", { request: row.request })} disabled={busy} className="h-11 px-5">
              {busyOp === "generate" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Try again
            </Button>
            <Button type="button" variant="outline" onClick={() => onAct("handoff")} disabled={busy} className={btnOutline}>
              {busyOp === "handoff" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Code2 aria-hidden />} Send to the Code Worker
            </Button>
            <Button type="button" variant="ghost" onClick={() => onAct("discard")} disabled={busy} className="h-11 text-white/70 hover:bg-white/5 hover:text-white">
              <Trash2 aria-hidden /> Discard
            </Button>
          </div>
        )}

        {row.status === "handoff" && (
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2 text-sm text-violet-200">
              <Code2 className="h-4 w-4 shrink-0" aria-hidden /> Sent to the Code Worker
            </p>
            <p className="text-sm text-white/65"><Lines>Home Assistant cannot do this one on its own. The Code Worker writes it, and it comes back here to look at when it is done.</Lines></p>
            {row.handoff_prompt && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => copyText(row.handoff_prompt!, "Prompt copied")} className={btnOutline}>
                  <Copy aria-hidden /> Copy prompt
                </Button>
                <Button type="button" variant="ghost" onClick={() => onAct("discard")} disabled={busy} className="h-11 text-white/70 hover:bg-white/5 hover:text-white">
                  <Trash2 aria-hidden /> Discard
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/* ---------- page ---------- */

export default function HomeHubAutomations() {
  const [rows, setRows] = useState<AutomationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [request, setRequest] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, Op>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [showEarlier, setShowEarlier] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("ha_automations" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      setLoadError(/does not exist|schema cache|relation/i.test(error.message)
        ? "The automation list is not set up in the database yet. You can still type a request once it is."
        : `Could not load your automations. ${error.message}`);
    } else {
      setLoadError(null);
      setRows((data ?? []) as unknown as AutomationRow[]);
    }
    setLoaded(true);
  }, []);

  // First load + realtime.
  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("ha_automations_page")
      .on("postgres_changes", { event: "*", schema: "public", table: "ha_automations" }, () => {
        clearTimeout(timer);
        timer = setTimeout(load, 250);
      })
      .subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [load]);

  // Poll every 4 s while anything is being drafted, installed or undone (realtime can miss a beat).
  const anyBusy = useMemo(() => rows.some((r) => BUSY_STATUSES.includes(r.status)), [rows]);
  useEffect(() => {
    if (!anyBusy) return;
    const iv = setInterval(load, pollInterval(4000, 0.05));
    return () => clearInterval(iv);
  }, [anyBusy, load]);

  const mergeRow = (row?: AutomationRow) => {
    if (!row?.id) return;
    setRows((prev) => {
      const has = prev.some((r) => r.id === row.id);
      return has ? prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [row, ...prev];
    });
  };

  const submit = async (text = request) => {
    const req = text.trim();
    if (!req || submitting) return;
    setSubmitting(true);
    setComposerError(null);
    const res = await callMaker({ op: "generate", request: req });
    setSubmitting(false);
    if (res.ok) {
      setRequest("");
      mergeRow(res.row);
      load();
    } else {
      setComposerError(res.error);
      load();
    }
  };

  const act = async (row: AutomationRow, op: Op, extra: Record<string, unknown> = {}) => {
    if (busy[row.id]) return;
    setBusy((b) => ({ ...b, [row.id]: op }));
    setCardErrors((e) => { const { [row.id]: _drop, ...rest } = e; return rest; });
    // Optimistic flip for the switch so it does not snap back while the Pi catches up.
    if (op === "toggle") setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, enabled: extra.enabled as boolean } : r)));
    const body = op === "generate" ? { op, ...extra } : { op, id: row.id, ...extra };
    const res = await callMaker(body as { op: Op } & Record<string, unknown>);
    setBusy((b) => { const { [row.id]: _drop, ...rest } = b; return rest; });
    if (res.ok) {
      mergeRow(res.row);
      // "Try again" made a fresh draft; retire the failed one so it does not pile up.
      if (op === "generate" && row.status === "failed") void callMaker({ op: "discard", id: row.id });
    } else {
      setCardErrors((e) => ({ ...e, [row.id]: res.error }));
    }
    load();
  };

  const earlier = rows.filter((r) => r.status === "undone" || r.status === "discarded");
  const current = rows.filter((r) => r.status !== "undone" && r.status !== "discarded");
  const drafting = rows.some((r) => r.status === "drafting");
  const canSend = request.trim().length > 0 && !submitting;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automation Maker"
        description="Say what should happen in your home. Tinker writes it, you look it over, then one tap installs it."
      />

      {/* Composer */}
      <section aria-label="Make an automation" className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 sm:p-6">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(251,191,36,0.10),transparent)] blur-2xl" />
        <div className="relative space-y-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300/90 to-orange-500/80" aria-hidden>
              <Wand2 className="h-5 w-5 text-black/75" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-white">What should happen?</h2>
              <p className="text-xs text-white/60">Tinker, Home Automation Engineer</p>
            </div>
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
          >
            <label htmlFor="automation-request" className="sr-only">What should happen?</label>
            <textarea
              id="automation-request"
              ref={inputRef}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={3}
              maxLength={1500}
              disabled={submitting}
              placeholder="When I get out of bed after 7 AM, turn on the kitchen lights"
              className="w-full resize-y rounded-xl border border-white/[0.1] bg-black/30 px-4 py-3.5 text-base leading-relaxed text-white placeholder:text-white/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-60 min-h-[112px]"
            />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <Button type="submit" disabled={!canSend} className="h-12 px-7 text-base motion-safe:active:scale-[0.97] motion-safe:transition-transform">
                {submitting ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Wand2 aria-hidden />} Make it
              </Button>
              <span className="hidden sm:inline text-xs text-white/60"><Lines>Enter to send. Shift and Enter for a new line.</Lines></span>
            </div>

            <div>
              <p className="mb-2 text-xs text-white/60">Try one of these</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    disabled={submitting}
                    onClick={() => { setRequest(ex.request); inputRef.current?.focus(); }}
                    className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border border-white/[0.1] bg-white/[0.04] px-4 text-sm text-white/85 hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50 motion-safe:active:scale-[0.97] motion-safe:transition-transform"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
          </form>

          {submitting && !drafting && <TinkerWorking steps={DRAFT_STEPS} />}

          {composerError && (
            <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3.5 py-3 text-sm text-red-200"><Lines>{composerError}</Lines></p>
          )}
        </div>
      </section>

      {loadError && (
        <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3 text-sm text-amber-100"><Lines>{loadError}</Lines></p>
      )}

      {/* List */}
      {!loaded ? (
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-2xl bg-white/[0.04]" />)}</div>
      ) : current.length === 0 && earlier.length === 0 ? (
        !loadError && (
          <Panel>
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.05]" aria-hidden><Wand2 className="h-5 w-5 text-white/60" /></span>
              <p className="text-sm font-medium text-white/90">Nothing made yet</p>
              <p className="max-w-sm text-sm text-white/60"><Lines>Type what you want above and tap Make it. What Tinker makes shows up here.</Lines></p>
            </div>
          </Panel>
        )
      ) : (
        <div className="space-y-4">
          {current.map((row) => (
            <AutomationCard
              key={row.id}
              row={row}
              busyOp={busy[row.id] ?? null}
              error={cardErrors[row.id] ?? null}
              onAct={(op, extra) => act(row, op, extra)}
            />
          ))}

          {earlier.length > 0 && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowEarlier((v) => !v)}
                aria-expanded={showEarlier}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-1 text-sm text-white/65 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              >
                <ChevronDown className={`h-4 w-4 motion-safe:transition-transform ${showEarlier ? "" : "-rotate-90"}`} aria-hidden />
                <span className="whitespace-nowrap">Earlier ({earlier.length})</span>
              </button>
              {showEarlier && earlier.map((row) => (
                <AutomationCard key={row.id} row={row} busyOp={null} error={null} onAct={() => undefined} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
