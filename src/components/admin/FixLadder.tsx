import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RotateCw, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { askScout } from "@/components/admin/scoutBus";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";

/*
 * The fix ladder for one monitor incident (edge function fix-ladder climbs it every 10 minutes):
 *   Auto-fix -> Free AI (Mac mini) -> Scout (autopilot) -> Claude (a ready prompt to paste).
 * The pane leads with the one thing to do: nothing (it's fixed / still working), one tap to let
 * Scout do the fix it found, or one tap to copy the Claude prompt.
 */

type Log = { at: string; by: string; text: string; ok: boolean | null };
type Issue = {
  key: string; status: string; title: string; fix_stage: string; fix_log: Log[] | null;
  fix_note: string | null; scout_ask: string | null; claude_prompt: string | null; ai_diagnosis: string | null;
};

const RUNGS = [
  { id: "auto", label: "Auto-fix" },
  { id: "free_ai", label: "Free AI" },
  { id: "scout", label: "Scout" },
  { id: "claude", label: "Claude" },
] as const;
const ORDER: Record<string, number> = { auto: 0, free_ai: 1, scout: 2, needs_yes: 2, claude: 3, fixed: 4 };
const WHO: Record<string, string> = { auto: "Auto-fix", free_ai: "Free AI", scout: "Scout", claude: "Claude", you: "You" };

const time = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function FixLadder({ issueKey, about, onClose }: { issueKey: string; about: string; onClose: () => void }) {
  const [iss, setIss] = useState<Issue | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("monitor_issues" as any)
      .select("key, status, title, fix_stage, fix_log, fix_note, scout_ask, claude_prompt, ai_diagnosis")
      .eq("key", issueKey).maybeSingle();
    setIss((data as unknown as Issue) ?? null);
  }, [issueKey]);

  useEffect(() => {
    load();
    const t = window.setInterval(() => { if (!document.hidden) load(); }, 15_000);
    return () => window.clearInterval(t);
  }, [load]);

  const retry = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.functions.invoke("fix-ladder", { body: { op: "retry", key: issueKey } });
    if (error || (data as any)?.ok === false) setErr(error?.message ?? (data as any)?.error ?? "Couldn't start it");
    await load();
    setBusy(false);
  };

  if (!iss) return null;
  const fixed = iss.status === "resolved" || iss.fix_stage === "fixed";
  const at = fixed ? 4 : ORDER[iss.fix_stage] ?? 0;
  const log = (iss.fix_log ?? []).slice(-8).reverse();

  return (
    <div className="border-t border-white/[0.06] px-5 py-4 bento:border-black/5">
      {/* The one thing to know / do */}
      {fixed ? (
        <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4 bento:bg-emerald-50">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300 bento:text-emerald-700"><Check className="h-4 w-4" aria-hidden /> Fixed</p>
          <p className="mt-1 text-[0.9375rem] text-white/85 bento:text-black/80">{iss.fix_note ?? "It's working again."}</p>
        </div>
      ) : iss.fix_stage === "needs_yes" ? (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 bento:bg-amber-50">
          <p className="text-sm font-semibold text-amber-200 bento:text-amber-800">Scout found the fix. It needs your yes.</p>
          <p className="mt-1 text-[0.9375rem] text-white/85 bento:text-black/80">{iss.scout_ask}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { askScout(`Yes, do it: ${iss.scout_ask}`, { about }); onClose(); }}
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-white px-5 text-sm font-semibold text-black active:scale-[0.98] bento:bg-[#111114] bento:text-[#fff]">
              <Check className="h-4 w-4" aria-hidden /> Yes, do it
            </button>
            {iss.claude_prompt && <CopyButton text={iss.claude_prompt} label="Or copy for Claude" className="h-11" />}
          </div>
        </div>
      ) : iss.fix_stage === "claude" ? (
        <div className="rounded-2xl border border-violet-400/25 bg-violet-400/10 p-4 bento:bg-violet-50">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-violet-200 bento:text-violet-800"><Sparkles className="h-4 w-4" aria-hidden /> Every AI here tried. Hand it to Claude.</p>
          <p className="mt-1 text-sm text-white/70 bento:text-black/65">One tap copies a prompt with everything that was tried. Paste it into Claude (desktop or Code).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {iss.claude_prompt && <CopyButton text={iss.claude_prompt} label="Copy prompt for Claude" className="h-11 bg-white px-5 text-black hover:bg-white/90 bento:bg-[#111114] bento:text-[#fff]" />}
          </div>
          {iss.claude_prompt && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-white/55 bento:text-black/55">See the prompt</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-[12px] leading-relaxed text-white/75 bento:bg-black/5 bento:text-black/75">{iss.claude_prompt}</pre>
            </details>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-[0.9375rem] bento:border-black/5 bento:bg-[#F3F2EE]">
          <Loader2 className="h-4 w-4 animate-spin text-white/60 bento:text-black/50" aria-hidden />
          <span>Working on it: {iss.fix_stage === "auto" ? "self-heal first" : iss.fix_stage === "free_ai" ? "the free AI is reading it" : "Scout is on it"}. Nothing needed from you yet.</span>
        </div>
      )}

      {/* The ladder */}
      <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Fix ladder">
        {RUNGS.map((r, n) => {
          const done = n < at || fixed;
          const now = !fixed && n === at;
          return (
            <li key={r.id} className="flex flex-col items-center gap-1 text-center">
              <span className={cn("grid h-7 w-7 place-items-center rounded-full text-[11px] font-semibold",
                done ? "bg-white/15 text-white/80 bento:bg-black/10 bento:text-black/70"
                  : now ? "bg-white text-black ring-2 ring-white/30 bento:bg-[#111114] bento:text-[#fff]"
                  : "bg-white/[0.04] text-white/35 bento:bg-black/5 bento:text-black/35")}>
                {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n + 1}
              </span>
              <span className={cn("text-[11px]", now ? "font-semibold text-white bento:text-black" : "text-white/50 bento:text-black/50")}>{r.label}</span>
            </li>
          );
        })}
      </ol>

      {/* What happened */}
      {log.length > 0 && (
        <ul className="mt-4 space-y-2">
          {log.map((l, n) => (
            <li key={n} className="flex gap-2 text-sm">
              <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full",
                l.ok === true ? "bg-emerald-400/20 text-emerald-300" : l.ok === false ? "bg-rose-400/15 text-rose-300" : "bg-white/10 text-white/50")}>
                {l.ok === true ? <Check className="h-3 w-3" aria-hidden /> : l.ok === false ? <X className="h-3 w-3" aria-hidden /> : <span className="h-1 w-1 rounded-full bg-current" />}
              </span>
              <span className="min-w-0 text-white/75 bento:text-black/70">
                <span className="font-medium text-white bento:text-black">{WHO[l.by] ?? l.by}</span> · {l.text}
                <span className="ml-1 text-white/35 bento:text-black/35">{time(l.at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!fixed && (
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={retry} disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/10 px-4 text-sm font-medium text-white/80 hover:bg-white/[0.06] disabled:opacity-50 bento:border-black/10 bento:text-black/75">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
            {busy ? "Trying (up to 2 min)…" : "Try the ladder again now"}
          </button>
          {err && <span className="text-sm text-rose-300">{err}</span>}
        </div>
      )}
    </div>
  );
}
