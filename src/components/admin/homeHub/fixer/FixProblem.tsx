import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, copyText } from "@/components/admin/homeHub/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { pollInterval } from "@/lib/polling";
import {
  Wrench, CheckCircle2, XCircle, Copy, ChevronDown, Send, Undo2, Trash2, Pencil, RotateCcw, Code2, Loader2, Search, X, ShieldCheck,
} from "lucide-react";
import { callFixer, type FixerOp, type FixRow, type FixStatus } from "./api";
import { Banner, Prose, Working, whenLong } from "./ui";

/* "Fix a problem": Jared says what went wrong, Tinker reads what Home Assistant recorded, explains it in plain words and proposes a
   fix with a before and after. One tap applies it, and Undo always puts the original back. Calls go to the ha-fixer edge function. */

const BUSY: FixStatus[] = ["gathering", "analyzing", "applying", "undoing"];

const LABEL: Record<FixStatus, string> = {
  gathering: "Reading the record",
  analyzing: "Working it out",
  proposed: "Fix ready",
  diagnosed: "Explained",
  applying: "Applying",
  applied: "Fixed",
  undoing: "Undoing",
  undone: "Undone",
  failed: "Did not work",
  discarded: "Discarded",
  handoff: "With the Code Worker",
};

const STEPS: Partial<Record<FixStatus, string[]>> = {
  gathering: ["Finding the devices you mean", "Reading what Home Assistant recorded", "Looking at what touched them"],
  analyzing: ["Reading the record", "Matching it to your automations", "Working out why", "Writing a safe fix"],
  applying: ["Saving a copy of the original", "Sending the fix to Home Assistant", "Letting Home Assistant check it"],
  undoing: ["Finding the saved copy", "Putting it back", "Letting Home Assistant check it"],
};

const EXAMPLES: { label: string; q: string }[] = [
  { label: "Lights ramped to 100%", q: "I walked into the bathroom at 6 AM, the lights came on dim like normal, then slowly ramped up to 100%. I don't want that." },
  { label: "Came on by themselves", q: "The kitchen lights came on by themselves last night and I don't know why." },
  { label: "Turned off too soon", q: "The living room lamp turned off a few minutes ago while I was still sitting there." },
];

const btnOutline = "h-11 border-white/15 bg-transparent text-white/85 hover:bg-white/5 hover:text-white";
const btnGhost = "h-11 text-white/70 hover:bg-white/5 hover:text-white";

function StatusPill({ status, waiting }: { status: FixStatus; waiting: boolean }) {
  const tone: Record<FixStatus, string> = {
    gathering: "text-amber-200 bg-amber-400/10 border-amber-400/25",
    analyzing: "text-amber-200 bg-amber-400/10 border-amber-400/25",
    proposed: "text-sky-200 bg-sky-400/10 border-sky-400/25",
    diagnosed: "text-sky-200 bg-sky-400/10 border-sky-400/25",
    applying: "text-amber-200 bg-amber-400/10 border-amber-400/25",
    applied: "text-green-300 bg-green-500/10 border-green-500/25",
    undoing: "text-amber-200 bg-amber-400/10 border-amber-400/25",
    undone: "text-white/60 bg-white/[0.04] border-white/10",
    failed: "text-red-300 bg-red-500/10 border-red-500/25",
    discarded: "text-white/60 bg-white/[0.04] border-white/10",
    handoff: "text-violet-200 bg-violet-400/10 border-violet-400/25",
  };
  const Icon = status === "applied" ? CheckCircle2 : status === "failed" ? XCircle : BUSY.includes(status) ? Loader2 : null;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${tone[status]}`}>
      {Icon && <Icon className={`h-3.5 w-3.5 ${Icon === Loader2 ? "motion-safe:animate-spin" : ""}`} aria-hidden />}
      {waiting ? "Waiting" : LABEL[status]}
    </span>
  );
}

function ConfidencePill({ level }: { level: FixRow["confidence"] }) {
  if (!level) return null;
  const t = level === "high" ? ["Tinker is sure", "text-green-300 bg-green-500/10 border-green-500/25"]
    : level === "medium" ? ["Tinker is fairly sure", "text-amber-200 bg-amber-400/10 border-amber-400/25"]
    : ["Tinker is not sure", "text-red-300 bg-red-500/10 border-red-500/25"];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${t[1]}`}>{t[0]}</span>;
}

function Bullets({ items, tone = "text-white/85" }: { items: string[]; tone?: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((s, i) => (
        <li key={i} className={`flex items-start gap-2.5 text-sm ${tone}`}>
          <span aria-hidden className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-white/40" />
          <span className="min-w-0"><Prose>{s}</Prose></span>
        </li>
      ))}
    </ul>
  );
}

function Disclosure({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-white/[0.08] bg-black/20">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm text-white/80 hover:text-white [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {right}
          <ChevronDown className="h-4 w-4 shrink-0 text-white/60 motion-safe:transition-transform group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      <div className="border-t border-white/[0.06] p-3">{children}</div>
    </details>
  );
}

/** Exactly what changes. Red lines go, green lines come in. The right edge fades softly where it scrolls. */
function DiffView({ diff }: { diff: NonNullable<FixRow["diff"]> }) {
  const text = diff.map((d) => (d.t === "=" ? `  (${d.s})` : `${d.t} ${d.s}`)).join("\n");
  return (
    <div>
      <div className="relative">
        <div className="max-h-80 overflow-auto rounded-lg bg-black/40 py-2 font-mono text-xs leading-relaxed" role="region" aria-label="The exact change" tabIndex={0}>
          {diff.map((d, i) => d.t === "=" ? (
            <div key={i} className="px-3 py-0.5 text-white/60">{d.s}</div>
          ) : (
            <div key={i} className={`flex gap-2 px-3 ${d.t === "+" ? "bg-green-500/[0.10] text-green-200" : d.t === "-" ? "bg-red-500/[0.10] text-red-200" : "text-white/70"}`}>
              <span aria-hidden className="w-3 shrink-0 select-none text-center">{d.t === " " ? "" : d.t}</span>
              <span className="whitespace-pre">{d.s || " "}</span>
            </div>
          ))}
        </div>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-black/40 to-transparent" />
      </div>
      <Button type="button" variant="outline" onClick={() => copyText(text, "Change copied")} className={`mt-3 ${btnOutline}`}>
        <Copy aria-hidden /> Copy the change
      </Button>
    </div>
  );
}

function FixCard({ row, busyOp, error, onAct }: {
  row: FixRow;
  busyOp: FixerOp | null;
  error: string | null;
  onAct: (op: FixerOp, extra?: Record<string, unknown>) => void;
}) {
  const [changing, setChanging] = useState(false);
  const [feedback, setFeedback] = useState("");
  const muted = row.status === "undone" || row.status === "discarded";
  const working = BUSY.includes(row.status);
  const busy = busyOp !== null;
  const waiting = (row.status === "analyzing" || row.status === "gathering") && (row.wait_tries ?? 0) > 0;
  const steps = waiting ? [row.error?.trim() || "Waiting on a free model. Tinker finishes on his own."] : STEPS[row.status] ?? ["Working on it"];
  const story = row.story ?? [];
  const title = row.culprit?.name?.trim() || (working ? "Looking into it" : row.status === "failed" ? "Could not look into it" : "A problem to look into");
  const isOff = row.fix?.type === "turn_off";
  const showFix = (row.status === "proposed" || row.status === "applied" || row.status === "applying" || row.status === "undoing" || row.status === "undone") && !!row.fix;

  return (
    <article aria-label={title} className={`relative overflow-hidden rounded-2xl border p-4 sm:p-6 ${muted ? "border-white/[0.05] bg-white/[0.015] opacity-80" : "border-white/[0.06] bg-white/[0.03]"}`}>
      {working && (
        <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(251,191,36,0.14),transparent)] blur-2xl motion-safe:animate-pulse" />
      )}
      <div className="relative space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            {row.culprit && <p className="text-xs uppercase tracking-wide text-white/55">Cause</p>}
            <h3 className="text-base font-semibold leading-snug text-white">{title}</h3>
            <p className="mt-1 text-xs text-white/60"><span className="whitespace-nowrap">{whenLong(row.created_at)}</span></p>
          </div>
          <StatusPill status={row.status} waiting={waiting} />
        </header>

        <p className="text-sm text-white/60">
          <span>You said: </span><span className="text-white/80">{row.question}</span>
        </p>

        {working && <Working steps={steps} />}

        {(row.window_note || (row.entities && row.entities.length > 0)) && !muted && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {row.window_note && <span className="text-xs text-white/60"><Prose>{`Looked at ${row.window_note}.`}</Prose></span>}
            {(row.entities ?? []).slice(0, 6).map((e) => (
              <span key={e.id} className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-white/75">{e.name}</span>
            ))}
          </div>
        )}

        {story.length > 0 && !working && (
          <div className="space-y-2 rounded-xl bg-white/[0.03] px-3.5 py-3">
            <p className="text-xs uppercase tracking-wide text-white/55">What happened</p>
            <Bullets items={story} tone="text-white/90" />
          </div>
        )}

        {row.timeline && row.timeline.length > 0 && !working && !muted && (
          <Disclosure title="What Home Assistant recorded">
            <ol className="space-y-1.5">
              {row.timeline.map((t, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="w-[5.5rem] shrink-0 whitespace-nowrap text-white/60 tabular-nums">{t.t}</span>
                  <span className="min-w-0 text-white/85"><Prose>{t.text}</Prose></span>
                </li>
              ))}
            </ol>
          </Disclosure>
        )}

        {row.culprit && !working && !muted && (
          <div className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <ConfidencePill level={row.confidence} />
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-white/70">
                {row.culprit.where === "ui" ? "Home Assistant editor" : row.culprit.file ? <>File <span className="whitespace-nowrap">{row.culprit.file}</span></> : "Settings file"}
              </span>
            </div>
            {row.culprit.why && <p className="text-sm text-white/80"><Prose>{row.culprit.why}</Prose></p>}
          </div>
        )}

        {row.status === "diagnosed" && (
          <Banner tone="amber" title={row.confidence === "low" || !row.culprit ? "Tinker is not sure enough to change anything" : "Tinker explained it, but has no safe change yet"}>
            {row.error?.trim() || "Nothing was changed. Tell Tinker more and he looks again, or hand it to the Code Worker to work out in the repo."}
          </Banner>
        )}

        {showFix && row.before_plain && row.after_plain && (
          <div className="space-y-3">
            {isOff && (
              <Banner tone="amber" title="This turns it off">
                The automation is switched off, not deleted. Undo switches it back on.
              </Banner>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded-xl border border-red-500/15 bg-red-500/[0.04] px-3.5 py-3">
                <p className="text-xs uppercase tracking-wide text-red-200/80">Now</p>
                <Bullets items={row.before_plain} />
              </div>
              <div className="space-y-2 rounded-xl border border-green-500/15 bg-green-500/[0.04] px-3.5 py-3">
                <p className="text-xs uppercase tracking-wide text-green-200/80">After the fix</p>
                <Bullets items={row.after_plain} />
              </div>
            </div>
            {row.diff && row.diff.length > 0 && (
              <Disclosure title="Show exactly what changes">
                <DiffView diff={row.diff} />
              </Disclosure>
            )}
          </div>
        )}

        {row.risky && row.status === "proposed" && (
          <Banner tone="amber" title="Worth a careful look">
            {row.risk_reason?.trim() || "This one touches something that matters, like a lock, a door, the heat or a sound at night."}
          </Banner>
        )}

        {row.status === "applied" && (
          <Banner tone="green" title={`Fixed ${row.applied_at ? whenLong(row.applied_at) : ""}`.trim()}>
            It is live in Home Assistant. The original is saved on your Pi, and Undo puts it back.
          </Banner>
        )}
        {row.restart_note && row.status === "applied" && <Banner tone="amber" title="One more step">{row.restart_note}</Banner>}

        {row.status === "undone" && <p className="text-sm text-white/60"><Prose>Put back the way it was. Nothing of this fix is left in Home Assistant.</Prose></p>}

        {row.status === "failed" && (row.needs_agent_update ? (
          <Banner tone="amber" title="Home Hub needs an update">
            {row.error?.trim() || "Your Pi needs the newest Home Hub update before Tinker can look into this. He asked it to update and starts again on his own."}
          </Banner>
        ) : (
          <Banner tone="red" title="This did not work">
            {row.error?.trim() || "Something stopped Tinker, and there was no more detail. Nothing was changed."}
          </Banner>
        ))}

        {row.status === "proposed" && row.error && (
          <Banner tone="red" title="That did not apply">{row.error}</Banner>
        )}

        {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3.5 py-3 text-sm text-red-200"><Prose>{error}</Prose></p>}

        {waiting && (
          <Button type="button" variant="ghost" onClick={() => onAct("discard")} disabled={busy} className={btnGhost}><Trash2 aria-hidden /> Discard</Button>
        )}

        {/* Buttons by status */}
        {row.status === "proposed" && (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-xs text-white/60">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-300/80" aria-hidden />
              <span><Prose>Nothing changes until you tap Apply. The original is saved first, and Undo puts it back.</Prose></span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => onAct("apply")} disabled={busy} className="h-11 px-5 motion-safe:active:scale-[0.97] motion-safe:transition-transform">
                {busyOp === "apply" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Wrench aria-hidden />} Apply fix
              </Button>
              <Button type="button" variant="outline" onClick={() => setChanging((v) => !v)} disabled={busy} aria-expanded={changing} className={btnOutline}><Pencil aria-hidden /> Change it</Button>
              <Button type="button" variant="ghost" onClick={() => onAct("discard")} disabled={busy} className={btnGhost}><Trash2 aria-hidden /> Not this</Button>
            </div>
          </div>
        )}

        {row.status === "diagnosed" && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setChanging((v) => !v)} disabled={busy} aria-expanded={changing} className="h-11 px-5"><Pencil aria-hidden /> Tell Tinker more</Button>
            <Button type="button" variant="outline" onClick={() => onAct("handoff")} disabled={busy} className={btnOutline}>
              {busyOp === "handoff" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Code2 aria-hidden />} Hand to the Code Worker
            </Button>
            <Button type="button" variant="ghost" onClick={() => onAct("discard")} disabled={busy} className={btnGhost}><Trash2 aria-hidden /> Discard</Button>
          </div>
        )}

        {changing && (row.status === "proposed" || row.status === "diagnosed") && (
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
            <label htmlFor={`fxfb-${row.id}`} className="block text-sm text-white/80">{row.status === "proposed" ? "What should be different?" : "What else should Tinker know?"}</label>
            <textarea
              id={`fxfb-${row.id}`}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder={row.status === "proposed" ? "Keep the fade, just stop it at 60%" : "It was the shower light, not the vanity light"}
              className="w-full resize-y rounded-xl border border-white/[0.1] bg-black/30 px-3.5 py-3 text-base text-white placeholder:text-white/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            />
            <Button type="submit" disabled={!feedback.trim() || busy} className="h-11 px-5">
              {busyOp === "revise" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Send aria-hidden />} Send it to Tinker
            </Button>
          </form>
        )}

        {row.status === "applied" && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => onAct("undo")} disabled={busy} className={btnOutline}>
              {busyOp === "undo" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Undo2 aria-hidden />} Undo
            </Button>
          </div>
        )}

        {(row.status === "failed" || row.status === "undone") && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => onAct("diagnose", { question: row.question, focus: row.focus })} disabled={busy} className="h-11 px-5">
              {busyOp === "diagnose" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Ask again
            </Button>
            {row.status === "failed" && !row.needs_agent_update && (
              <Button type="button" variant="outline" onClick={() => onAct("handoff")} disabled={busy} className={btnOutline}>
                {busyOp === "handoff" ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Code2 aria-hidden />} Hand to the Code Worker
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onAct("discard")} disabled={busy} className={btnGhost}><Trash2 aria-hidden /> Discard</Button>
          </div>
        )}

        {row.status === "handoff" && (
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2 text-sm text-violet-200"><Code2 className="h-4 w-4 shrink-0" aria-hidden /> Sent to the Code Worker</p>
            <p className="text-sm text-white/65"><Prose>{row.handback ?? "He investigates in the repo and writes up the exact change. It shows here when he is done. Nothing in Home Assistant is touched."}</Prose></p>
            <div className="flex flex-wrap gap-2">
              {row.handoff_prompt && (
                <Button type="button" variant="outline" onClick={() => copyText(row.handoff_prompt!, "Prompt copied")} className={btnOutline}><Copy aria-hidden /> Copy prompt</Button>
              )}
              <Button type="button" variant="ghost" onClick={() => onAct("discard")} disabled={busy} className={btnGhost}><Trash2 aria-hidden /> Discard</Button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export type FixPreset = { entity_id: string; name: string; n: number };

export function FixProblem({ preset }: { preset: FixPreset | null }) {
  const [rows, setRows] = useState<FixRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [focus, setFocus] = useState<{ entity_id: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, FixerOp>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [showEarlier, setShowEarlier] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastCheck = useRef(0);

  const read = () => supabase.from("ha_fixes" as never).select("*").order("created_at", { ascending: false }).limit(20);

  const load = useCallback(async () => {
    let { data, error } = await read();
    if (error && !/does not exist|schema cache|relation/i.test(error.message)) {
      // Tinker checks (and, if it is only a missing permission, repairs) his own page, then reads once more. At most once a minute.
      if (Date.now() - lastCheck.current > 60_000) {
        lastCheck.current = Date.now();
        try { await supabase.rpc("tinker_page_check" as never); } catch { /* the reload below decides */ }
        ({ data, error } = await read());
        if (error) { try { await supabase.rpc("tinker_page_check" as never, { p_still_failing: true, p_load_error: error.message } as never); } catch { /* best effort */ } }
      }
    }
    if (error) {
      setLoadError(/does not exist|schema cache|relation/i.test(error.message)
        ? "The troubleshooting notes are not set up in the database yet."
        : "Tinker can't open his troubleshooting notes right now. He's been told and is on it.");
    } else {
      setLoadError(null);
      setRows((data ?? []) as unknown as FixRow[]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("ha_fixes_page")
      .on("postgres_changes", { event: "*", schema: "public", table: "ha_fixes" }, () => { clearTimeout(timer); timer = setTimeout(load, 250); })
      .subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [load]);

  const anyBusy = useMemo(() => rows.some((r) => BUSY.includes(r.status)), [rows]);
  useEffect(() => {
    if (!anyBusy) return;
    const iv = setInterval(load, pollInterval(4000, 0.05));
    return () => clearInterval(iv);
  }, [anyBusy, load]);

  // "Fix this" on the list opens this tab with that automation filled in.
  useEffect(() => {
    if (!preset) return;
    setFocus({ entity_id: preset.entity_id, name: preset.name });
    setQuestion((q) => (q.trim() ? q : `Something is off with "${preset.name}": `));
    const t = setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 60);
    return () => clearTimeout(t);
  }, [preset]);

  const mergeRow = (row?: FixRow) => {
    if (!row?.id) return;
    setRows((prev) => (prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [row, ...prev]));
  };

  const submit = async () => {
    const q = question.trim();
    if (q.length < 6 || submitting) return;
    setSubmitting(true);
    setComposerError(null);
    const res = await callFixer({ op: "diagnose", question: q, focus: focus?.entity_id ?? null });
    setSubmitting(false);
    if (res.ok) { setQuestion(""); setFocus(null); mergeRow(res.row); } else setComposerError(res.error ?? "Something went wrong.");
    load();
  };

  const act = async (row: FixRow, op: FixerOp, extra: Record<string, unknown> = {}) => {
    if (busy[row.id]) return;
    setBusy((b) => ({ ...b, [row.id]: op }));
    setCardErrors((e) => { const { [row.id]: _drop, ...rest } = e; return rest; });
    const body = op === "diagnose" ? { op, ...extra } : { op, id: row.id, ...extra };
    const res = await callFixer(body as { op: FixerOp } & Record<string, unknown>);
    setBusy((b) => { const { [row.id]: _drop, ...rest } = b; return rest; });
    if (res.ok) {
      mergeRow(res.row);
      if (op === "diagnose") void callFixer({ op: "discard", id: row.id });   // "Ask again" retires the old card
    } else {
      setCardErrors((e) => ({ ...e, [row.id]: res.error ?? "Something went wrong." }));
    }
    load();
  };

  const earlier = rows.filter((r) => r.status === "undone" || r.status === "discarded");
  const current = rows.filter((r) => r.status !== "undone" && r.status !== "discarded");
  const canSend = question.trim().length >= 6 && !submitting;

  return (
    <div className="space-y-6">
      <section aria-label="What went wrong" className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 sm:p-6">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(56,189,248,0.10),transparent)] blur-2xl" />
        <div className="relative space-y-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-300/90 to-indigo-500/80" aria-hidden><Search className="h-5 w-5 text-black/75" /></span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-white">What went wrong?</h2>
              <p className="text-xs text-white/60"><Prose>Say what you saw, where, and roughly when. Tinker reads what Home Assistant recorded, tells you what happened, and proposes a fix you can undo.</Prose></p>
            </div>
          </div>

          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            {focus && (
              <div className="flex items-center gap-2">
                <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-sky-400/25 bg-sky-400/10 pl-3.5 pr-1 text-sm text-sky-100">
                  <span>About <span className="font-medium">{focus.name}</span></span>
                  <button type="button" onClick={() => setFocus(null)} aria-label={`Stop focusing on ${focus.name}`} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-sky-100/80 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </span>
              </div>
            )}
            <label htmlFor="fix-question" className="sr-only">What went wrong?</label>
            <textarea
              id="fix-question"
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }}
              rows={4}
              maxLength={1500}
              disabled={submitting}
              placeholder="I walked into the bathroom at 6 AM, the lights came on dim, then slowly ramped to 100%. I don't want that."
              className="min-h-[124px] w-full resize-y rounded-xl border border-white/[0.1] bg-black/30 px-4 py-3.5 text-base leading-relaxed text-white placeholder:text-white/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <Button type="submit" disabled={!canSend} className="h-12 px-7 text-base motion-safe:active:scale-[0.97] motion-safe:transition-transform">
                {submitting ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Search aria-hidden />} Look into it
              </Button>
              <span className="hidden text-xs text-white/60 sm:inline"><Prose>Enter to send. Shift and Enter for a new line.</Prose></span>
            </div>
            <div>
              <p className="mb-2 text-xs text-white/60">Try one of these</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    disabled={submitting}
                    onClick={() => { setQuestion(ex.q); inputRef.current?.focus(); }}
                    className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border border-white/[0.1] bg-white/[0.04] px-4 text-sm text-white/85 hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-50 motion-safe:active:scale-[0.97] motion-safe:transition-transform"
                  >{ex.label}</button>
                ))}
              </div>
            </div>
          </form>

          {composerError && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3.5 py-3 text-sm text-red-200"><Prose>{composerError}</Prose></p>}
        </div>
      </section>

      {loadError && <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3 text-sm text-amber-100"><Prose>{loadError}</Prose></p>}

      {!loaded ? (
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-2xl bg-white/[0.04]" />)}</div>
      ) : loadError && rows.length === 0 ? null : (
        <div className="space-y-4">
          {current.length === 0 && (
            <Panel>
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.05]" aria-hidden><Search className="h-5 w-5 text-white/60" /></span>
                <p className="text-sm font-medium text-white/90">Nothing to look into</p>
                <p className="max-w-sm text-sm text-white/60"><Prose>When something in the house does what you did not want, say so above. What Tinker finds shows up here.</Prose></p>
              </div>
            </Panel>
          )}
          {current.map((row) => (
            <FixCard key={row.id} row={row} busyOp={busy[row.id] ?? null} error={cardErrors[row.id] ?? null} onAct={(op, extra) => act(row, op, extra)} />
          ))}
          {earlier.length > 0 && (
            <div className="space-y-3">
              <button type="button" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-1 text-sm text-white/65 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30">
                <ChevronDown className={`h-4 w-4 motion-safe:transition-transform ${showEarlier ? "" : "-rotate-90"}`} aria-hidden />
                <span className="whitespace-nowrap">Earlier ({earlier.length})</span>
              </button>
              {showEarlier && earlier.map((row) => <FixCard key={row.id} row={row} busyOp={null} error={null} onAct={() => undefined} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
