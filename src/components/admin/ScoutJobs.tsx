import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useScoutAutoRun } from "./ScoutAutoRun";
import { Play, X, ChevronRight, Terminal, Check, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Run cards for shell jobs Scout wants to run on the Mac mini.
 *
 * Scout can only propose (a mac_jobs row with status "proposed"). Nothing runs
 * until Jared taps Run here, which calls mac_job_decide() with his own session;
 * the table's trigger refuses any other way to approve. The Mac agent picks the
 * job up within ~3s, and output streams back into the card.
 *
 * When a job Jared approved from this window finishes, onFinished fires so Scout
 * can read the output and say whether it worked.
 */

export interface MacJob {
  id: string;
  created_at: string;
  title: string;
  why: string | null;
  script: string;
  cwd: string | null;
  timeout_s: number;
  status: "proposed" | "approved" | "running" | "done" | "failed" | "cancelled" | "expired";
  thread_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  output: string;
}

const LIVE = ["proposed", "approved", "running"];

export function useMacJobs(threadId: string | null, active: boolean) {
  const [jobs, setJobs] = useState<MacJob[]>([]);
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const sel = "id, created_at, title, why, script, cwd, timeout_s, status, thread_id, started_at, finished_at, exit_code, output";
    const live = supabase.from("mac_jobs" as any).select(sel).in("status", LIVE).order("created_at").limit(5);
    const recent = threadId
      ? supabase.from("mac_jobs" as any).select(sel).eq("thread_id", threadId).not("status", "in", `(${LIVE.join(",")})`)
          .gte("finished_at", since).order("created_at").limit(3)
      : null;
    const [a, b] = await Promise.all([live, recent ?? Promise.resolve({ data: [] as unknown[] })]);
    const all = [...((b.data ?? []) as unknown as MacJob[]), ...((a.data ?? []) as unknown as MacJob[])];
    const seen = new Set<string>();
    setJobs(all.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true))));
  }, [threadId]);

  useEffect(() => {
    load();
    const running = jobs.some((j) => j.status === "running" || j.status === "approved");
    const t = window.setInterval(() => { if (!document.hidden) load(); }, running ? 1500 : active ? 4000 : 20000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, active, jobs.map((j) => j.status).join()]);

  return { jobs, refresh: load };
}

function ago(iso: string | null) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}

function JobCard({ job, onDecided }: { job: MacJob; onDecided: (id: string, run: boolean) => void }) {
  const [showScript, setShowScript] = useState(false);
  const { autoRun, setAutoRun } = useScoutAutoRun();
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const outRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [job.output]);

  const decide = async (run: boolean) => {
    setWorking(true);
    setErr(null);
    const { data, error } = await (supabase.rpc as any)("mac_job_decide", { p_id: job.id, p_run: run });
    setWorking(false);
    if (error) setErr(error.message);
    else if (data && data.ok === false) setErr(data.error);
    else onDecided(job.id, run);
  };

  const done = job.status === "done";
  const bad = job.status === "failed" || job.status === "expired";
  const live = job.status === "running" || job.status === "approved";

  return (
    // Sized and shaped like the rest of the timeline: the same 2xl radius and the same
    // max width as a chat bubble, left-aligned with Scout's replies. A Run card is Scout
    // asking for something, so it should read as part of the conversation rather than as
    // a separate panel bolted to the bottom of it. The amber border stays - that one
    // carries meaning (it is the state that needs a tap).
    <div className={cn(
      "scout-card-in max-w-[85%] rounded-2xl rounded-bl-sm border p-3 text-white sm:max-w-[80%]",
      "transition-[border-color,background-color] duration-500",
      job.status === "proposed" ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-white/10 bg-white/[0.03]",
    )}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/10">
          {live ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : done ? <Check className="h-3.5 w-3.5 text-emerald-300" />
            : bad ? <AlertTriangle className="h-3.5 w-3.5 text-red-300" /> : <Terminal className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-semibold leading-snug sm:text-sm">{job.title}</p>
          <p className="mt-0.5 text-xs text-white/60">
            {job.status === "proposed" && "Scout wants to do this on your Mac mini. Nothing happens until you tap Yes."}
            {job.status === "approved" && "Starting on your Mac mini…"}
            {job.status === "running" && `Working on it on your Mac mini (started ${ago(job.started_at)})`}
            {done && "Done. It worked."}
            {job.status === "failed" && "It didn't work. Scout will look at why."}
            {job.status === "cancelled" && "You said no. Nothing was done."}
            {job.status === "expired" && "Too old to run now. Ask Scout again."}
          </p>
        </div>
      </div>
      {job.why && job.status === "proposed" && <p className="mt-2 text-[0.9375rem] leading-relaxed text-white/75 sm:text-sm">{job.why}</p>}

      <button type="button" onClick={() => setShowScript((v) => !v)}
        className="mt-2 flex items-center gap-1 text-[0.6875rem] text-white/50 hover:text-white">
        <ChevronRight className={cn("h-3 w-3 transition-transform duration-200", showScript && "rotate-90")} />
        {showScript ? "Hide the exact commands" : "Show the exact commands"}
      </button>
      <div className={cn("scout-collapse", showScript && "is-open")}>
        <div>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/60 p-2 font-mono text-[0.6875rem] leading-relaxed text-emerald-200/90">
            {job.script}
          </pre>
        </div>
      </div>

      {(job.output || live) && job.status !== "proposed" && (
        <pre ref={outRef}
          className="scout-card-in mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/70 p-2 font-mono text-[0.6875rem] leading-relaxed text-white/80">
          {job.output || "waiting for output..."}
        </pre>
      )}

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      {job.status === "proposed" && (
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" disabled={working} onClick={() => decide(true)}
            className="scout-press h-8 flex-1 bg-white text-black hover:bg-white/90">
            <Play className="mr-1.5 h-3.5 w-3.5" /> Yes, do it
          </Button>
          <Button size="sm" variant="ghost" disabled={working} onClick={() => decide(false)}
            className="scout-press h-8 border border-white/15 text-white/70 hover:bg-white/5 hover:text-white">
            <X className="mr-1 h-3.5 w-3.5" /> No
          </Button>
        </div>
      )}
      {job.status === "proposed" && autoRun === false && (
        <button type="button" onClick={() => setAutoRun(true)}
          className="mt-2 text-[0.6875rem] text-white/50 underline-offset-2 hover:text-white hover:underline">
          Don't ask me each time: turn on Auto-run
        </button>
      )}
      {live && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" disabled={working} onClick={() => decide(false)}
            className="h-7 text-xs text-white/60 hover:bg-red-500/10 hover:text-red-300">Stop it</Button>
        </div>
      )}
    </div>
  );
}

export function ScoutJobs({ jobs, refresh, onFinished }: {
  jobs: MacJob[];
  refresh: () => void;
  onFinished: (job: MacJob) => void;
}) {
  // Jobs approved or seen running in this window; when one finishes, Scout gets told once.
  const mine = useRef<Set<string>>(new Set());
  const told = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const j of jobs) {
      // Seen starting or running in this window (auto-run starts them with no tap): follow it too.
      if (j.status === "approved" || j.status === "running") mine.current.add(j.id);
      if (mine.current.has(j.id) && !told.current.has(j.id) && ["done", "failed"].includes(j.status)) {
        told.current.add(j.id);
        onFinished(j);
      }
    }
  }, [jobs, onFinished]);

  if (!jobs.length) return null;
  return (
    <div className="space-y-3">
      {jobs.map((j) => (
        <JobCard key={j.id} job={j} onDecided={(id, run) => { if (run) mine.current.add(id); refresh(); }} />
      ))}
    </div>
  );
}
