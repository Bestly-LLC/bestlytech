/**
 * Partner portal → Ava demo. Eli types a phone number and Ava calls it, so investors (or Bill, who owns RoofGuard)
 * hear her live. Edge fn roofguard-caller {action:"demo_call"} plays a fictional facility (Riverside Medical Center),
 * never a real prospect, capped per day. The sheet then shows the conversation as it happens, Ava's summary, and
 * the recording.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, PhoneCall, RotateCcw } from "lucide-react";
import { LiveTranscript, Recording, StagePill, type Line } from "@/components/admin/roofguard/AvaCalls";
import { AvaScorecard } from "@/components/admin/roofguard/AvaScorecard";

type Phase = "form" | "calling" | "done";
type Result = { status: string; outcome: string | null; summary: string | null; duration_sec: number | null; transcript: Line[] };

const fmt = (v: string) => {
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};
const stageOf = (o: string | null) => ({ booked: "booked", callback_set: "callback", voicemail_left: "voicemail", gatekeeper_blocked: "gatekeeper",
  dm_identified: "gatekeeper", not_interested: "not_interested", do_not_call: "dnc", no_answer: "no_answer" } as Record<string, string>)[o ?? ""] ?? "other";

export function AvaDemoSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [view, setView] = useState<"score" | "demo">("score");
  const [phase, setPhase] = useState<Phase>("form");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState("dialing");
  const [result, setResult] = useState<Result | null>(null);
  const started = useRef(0);
  const [, tick] = useState(0);

  const digits = phone.replace(/\D/g, "");
  const valid = digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));

  const reset = () => { setPhase("form"); setCallId(null); setLines([]); setResult(null); setErr(null); setStatus("dialing"); };
  useEffect(() => { if (!open && phase !== "calling") reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.functions.invoke("roofguard-caller", { body: { action: "demo_call", phone, name } });
    setBusy(false);
    if (error || !data?.ok) {
      let msg = data?.error as string | undefined;
      if (!msg && error && "context" in error) msg = await (error as { context: Response }).context.json().then((j) => j.error).catch(() => undefined);
      setErr(msg ?? "The call didn't go out. Try again in a minute."); return;
    }
    started.current = Date.now(); setCallId(data.call_id); setPhase("calling");
  };

  // while calling: the conversation so far, every 2 seconds; then Ava's summary once the call is logged
  useEffect(() => {
    if (phase !== "calling" || !callId) return;
    let stop = false;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const poll = async () => {
      while (!stop) {
        const { data } = await supabase.functions.invoke("roofguard-caller", { body: { action: "live", call_id: callId } });
        const c = data?.calls?.[0];
        if (c) { setLines(c.transcript ?? []); setStatus(c.status); }
        const r = await supabase.functions.invoke("roofguard-caller", { body: { action: "call_result", call_id: callId } });
        if (r.data?.ok && r.data.status === "completed") { setResult(r.data as Result); setPhase("done"); return; }
        if (Date.now() - started.current > 20 * 60_000) { setPhase("done"); return; }
        await new Promise((ok) => setTimeout(ok, 2000));
      }
    };
    void poll();
    return () => { stop = true; clearInterval(t); };
  }, [phase, callId]);

  const secs = Math.round((Date.now() - started.current) / 1000);
  const label = status === "in-progress" ? "On the call" : status === "done" || status === "processing" ? "Wrapping up" : "Ringing";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-xl bento:bg-[#F3F2EE]">
        <div className="border-b border-white/[0.06] px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <SheetTitle className="text-lg font-semibold text-white">Ava</SheetTitle>
          <SheetDescription className="mt-1 text-sm text-white/60">
            {view === "score" ? "How she's doing against the goal: 6 meetings booked with you every week."
              : "Type a number and Ava calls it in a few seconds. Whoever answers plays the facilities director at Riverside Medical Center, a made-up hospital."}
          </SheetDescription>
          <div role="tablist" aria-label="Ava" className="mt-3 inline-flex rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
            {([["score", "Scorecard"], ["demo", "Demo call"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
                className={cn("min-h-[36px] min-w-[104px] rounded-lg px-4 text-sm font-medium transition-colors",
                  view === id ? "bg-white text-black shadow-sm" : "text-white/65 hover:text-white")}>{label}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-5 px-5 py-5">
          {view === "score" && <AvaScorecard narrow />}
          {view === "demo" && phase === "form" && (
            <form onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void call(); }} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-white/80">Phone number</span>
                <input value={phone} onChange={(e) => setPhone(fmt(e.target.value))} inputMode="tel" autoComplete="tel" type="tel" placeholder="(555) 123-4567"
                  className="h-[52px] w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[17px] tabular-nums text-white outline-none placeholder:text-white/40 focus:border-white/30 bento:bg-[var(--bento-well)]" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-white/80">Their first name <span className="text-white/45">(optional)</span></span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="e.g. Bill" maxLength={40}
                  className="h-[52px] w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[17px] text-white outline-none placeholder:text-white/40 focus:border-white/30 bento:bg-[var(--bento-well)]" />
                <span className="mt-1.5 block text-xs text-white/50">Ava asks for them by name, like a real cold call.</span>
              </label>
              {err && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
              <button type="submit" disabled={!valid || busy}
                className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-[17px] font-semibold text-[#052E1F] transition active:scale-[0.98] disabled:opacity-40">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <PhoneCall className="h-5 w-5" aria-hidden />}
                {busy ? "Calling…" : "Have Ava call"}
              </button>
              <ul className="space-y-1.5 rounded-2xl bg-white/[0.04] p-4 text-sm text-white/65">
                <li className="font-medium text-white/85">Things to try</li>
                <li>Play the receptionist first: "Who's calling?"</li>
                <li>Ask "Are you a real person?" (she'll say she's an AI)</li>
                <li>Push back: "We already have a roofer."</li>
                <li>Agree to a meeting and watch her book it with Eli.</li>
              </ul>
              <p className="text-xs text-white/45">Only call someone who's expecting it. The phone may show it as an unknown number; tell them to pick up.</p>
            </form>
          )}

          {view === "demo" && phase !== "form" && (
            <>
              <div className="flex items-center gap-3">
                {phase === "calling" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />Live
                  </span>
                ) : <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden />}
                <span className="text-[15px] font-semibold text-white">{phase === "calling" ? label : "Call finished"}</span>
                <span className={cn("ml-auto whitespace-nowrap font-mono text-[15px] tabular-nums", phase === "calling" ? "text-white" : "text-white/50")}>
                  {phase === "calling" ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : result?.duration_sec != null
                    ? `${Math.floor(result.duration_sec / 60)}:${String(result.duration_sec % 60).padStart(2, "0")}` : ""}
                </span>
              </div>

              {phase === "done" && result && (
                <div className="space-y-3 rounded-2xl bg-white/[0.04] p-4">
                  <StagePill stage={stageOf(result.outcome)} />
                  {result.summary && <p className="text-[15px] leading-relaxed text-white/85">{result.summary}</p>}
                  {callId && <Recording callId={callId} />}
                </div>
              )}

              <LiveTranscript lines={phase === "done" && result?.transcript?.length ? result.transcript : lines} live={phase === "calling"}
                them={name.trim() || "Them"} className={phase === "calling" ? "max-h-[55vh]" : ""} />

              {phase === "done" && (
                <button type="button" onClick={reset}
                  className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-white/10 px-5 text-[15px] font-semibold text-white ring-1 ring-white/15 active:scale-[0.98]">
                  <RotateCcw className="h-4 w-4" aria-hidden />Call another number</button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
