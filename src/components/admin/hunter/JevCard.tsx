/**
 * The "Jev" card on the Hunter page.
 * Jev (TypeSafe AI) is a very fast AI model that answers with exact odds instead of paragraphs. Hunter uses it to guess which leads to call first.
 * Status (connected, last scored, scored today, average speed, estimated cost this month), a write-only key field (saved to the Vault by
 * hunter_jev_key_put, never shown again), an on/off switch, the nightly limits, and a test button that scores one lead.
 * Until a key is saved Hunter scores with the free AI ladder and says so on every lead ("Free AI estimate").
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, PlugZap, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { Switch } from "@/components/ui/switch";
import { Card, NB, NumberField, Stat, glue, when } from "./shared";
import { OutcomeBar, PriorityRing, RoleChip, ScorerBadge, WindowChip, pct, score100, type Outcome } from "./scoreUi";

type Status = {
  key_saved: boolean; saved_at: string | null; enabled: boolean; connected: boolean; last_scored_at: string | null;
  scored_today: number; free_today: number; avg_latency_ms: number | null; cost_month: number; tokens_month: number;
  fail_streak: number; last_error: string | null; score_cap_jev: number; score_cap_free: number;
};
type TestResult = {
  ok: boolean; error?: string; note?: string | null; scorer?: "jev" | "free_ai"; company?: string; model?: string; latency_ms?: number | null;
  p_reach_dm?: number; outcome_probs?: Record<Outcome, number>; dm_role?: string; best_window?: string; p_fit?: number; reason?: string;
};

/** $0.0042 -> "$0.004", $12.5 -> "$12.50". Never shows $0.00 for a month that has real, tiny spend. */
const dollars = (n: number) => n === 0 ? "$0.00" : n < 0.001 ? "under $0.001" : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;

export function JevCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const writes = useRef(0);

  const load = useCallback(async () => {
    const { data, error } = await rpcArgs<Status>("hunter_jev_status");
    if (writes.current > 0) return;
    if (error || !data) { setErr("Couldn't load Jev's status."); return; }
    setErr(null); setSt(data);
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const saveKey = async () => {
    if (saving || !key.trim()) return;
    setSaving(true); writes.current += 1;
    const { error } = await rpcArgs("hunter_jev_key_put", { p_value: key.trim() });
    writes.current -= 1; setSaving(false);
    if (error) { toast.error(/look like/i.test(error.message ?? "") ? "That doesn't look like a Jev key." : "Couldn't save the key. Try again."); return; }
    setKey(""); setResult(null);
    toast.success("Jev key saved to the vault");
    void load();
  };

  const write = async (fn: string, args: Record<string, unknown>, ok: string) => {
    writes.current += 1;
    const { error } = await rpcArgs(fn, args);
    writes.current -= 1;
    if (error) { toast.error("Couldn't save. Try again."); return; }
    toast.success(ok); void load();
  };

  const test = async () => {
    if (testing) return;
    setTesting(true); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("hunter-score", { body: { op: "test" } });
      setResult(error || !data ? { ok: false, error: "Couldn't reach the scorer. Try again in a minute." } : (data as TestResult));
    } catch { setResult({ ok: false, error: "Couldn't reach the scorer. Try again in a minute." }); }
    setTesting(false); void load();
  };

  const chip = !st ? null : st.connected
    ? { tone: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25", text: "Connected", Icon: CheckCircle2 }
    : st.key_saved
      ? { tone: "bg-amber-500/10 text-amber-200 ring-amber-500/30", text: "Key saved, switched off", Icon: PlugZap }
      : { tone: "bg-white/[0.05] text-white/75 ring-white/10", text: "Not connected", Icon: PlugZap };

  return (
    <Card title="Jev" hint="Jev is a very fast AI model (from TypeSafe AI) that answers with exact odds instead of paragraphs; Hunter uses it to guess which leads to call first."
      aside={chip && <span role="status" className={cn("inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold ring-1", chip.tone)}><chip.Icon className="h-4 w-4 shrink-0" aria-hidden />{chip.text}</span>}>
      {err && <p role="alert" className="mb-3 rounded-xl bg-amber-500/10 p-3 text-[14px] text-amber-100 ring-1 ring-amber-500/30">{err}</p>}
      {!st && !err && <div className="h-[120px] rounded-xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />}

      {st && (<div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Last scored" value={st.last_scored_at ? when(st.last_scored_at) : "never"} />
          <Stat label="Scored today" value={st.scored_today} hint={st.free_today ? `plus${NB}${st.free_today} by free AI` : undefined} />
          <Stat label="Average speed" value={st.avg_latency_ms == null ? "–" : `${st.avg_latency_ms}${NB}ms`} />
          <Stat label="Estimated cost this month" value={dollars(st.cost_month)} />
        </div>

        {st.fail_streak > 0 && st.key_saved && (
          <p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-[14px] leading-relaxed text-amber-100 ring-1 ring-amber-500/30">
            Jev has failed {st.fail_streak} {st.fail_streak === 1 ? "night" : "nights"} running{st.last_error ? `: ${st.last_error}` : ""} Hunter keeps scoring with the free AI meanwhile.
          </p>
        )}

        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void saveKey(); }}>
          <label htmlFor="jev-key" className="flex items-center gap-2 text-[15px] font-medium text-white"><KeyRound className="h-4 w-4 text-white/70" aria-hidden />{st.key_saved ? "Replace the Jev key" : "Paste your Jev key"}</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="jev-key" type="password" name="jev-key" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
              value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste key, then Save"
              className="h-12 min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3.5 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/50 focus:ring-white/40" />
            <button type="submit" disabled={saving || key.trim().length < 12}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-white px-5 text-[15px] font-semibold text-black transition-opacity hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save key
            </button>
          </div>
          <p className="text-[13px] leading-relaxed text-white/65">
            {st.key_saved ? `Saved ${when(st.saved_at)}. ` : ""}It goes straight to the Bestly vault and is never shown again.{" "}
            {!st.key_saved && <>Get one at{" "}<a href="https://console.typesafe.ai" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-sky-300 underline-offset-2 hover:underline">console.typesafe.ai<ExternalLink className="h-3 w-3" aria-hidden /></a> (early access).</>}
          </p>
        </form>

        {st.key_saved && (
          <div className="flex items-center justify-between gap-3 text-[15px] text-white/85">
            <span>Use Jev for scoring</span>
            <Switch checked={st.enabled} onCheckedChange={(v) => void write("hunter_source_set", { p_slug: "jev", p_enabled: v }, v ? "Jev is on" : "Jev is off, free AI scores instead")} aria-label="Use Jev for scoring" />
          </div>
        )}

        <div className="space-y-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
          <NumberField label="Jev scores a night" value={st.score_cap_jev} min={0} max={5000} suffix="max"
            onSave={(n) => void write("hunter_score_caps_set", { p_jev: n }, `Jev limit set to ${n}`)} />
          <NumberField label="Free AI scores a night" value={st.score_cap_free} min={0} max={2000} suffix="max"
            onSave={(n) => void write("hunter_score_caps_set", { p_free: n }, `Free AI limit set to ${n}`)} />
        </div>
        {!st.connected && <p className="text-[13px] leading-relaxed text-white/65">Until Jev is connected, every score is labeled "Free AI estimate". It is a reasoned guess from the free AI, not a measured number.</p>}

        <div>
          <button type="button" onClick={() => void test()} disabled={testing}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-5 text-[15px] font-semibold text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60 sm:w-auto">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}Score one lead
          </button>
          <div role="status" aria-live="polite">
            {result && !result.ok && <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-[14px] leading-relaxed text-amber-100 ring-1 ring-amber-500/30">{result.error}</p>}
            {result?.ok && result.outcome_probs && (
              <div className="mt-3 space-y-3 rounded-xl bg-white/[0.04] p-3.5 ring-1 ring-white/10">
                <div className="flex items-center gap-3">
                  <PriorityRing value={score100((result.p_reach_dm ?? 0) * (result.p_fit ?? 0))} />
                  <div className="min-w-0">
                    <p className="break-words text-[15px] font-semibold text-white">{result.company}</p>
                    <p className="text-[13px] text-white/65">Reaches decision maker{NB}<span className="font-semibold tabular-nums text-white">{pct(result.p_reach_dm)}</span>{result.latency_ms ? <>{" · "}<span className="tabular-nums">{result.latency_ms}{NB}ms</span></> : null}</p>
                  </div>
                </div>
                <OutcomeBar probs={result.outcome_probs} />
                <div className="flex flex-wrap gap-1.5">
                  {result.best_window && <WindowChip w={result.best_window} />}
                  {result.dm_role && <RoleChip role={result.dm_role} />}
                  {result.scorer && <ScorerBadge scorer={result.scorer} />}
                </div>
                {result.reason && <p className="text-[14px] leading-relaxed text-white/80">{glue(result.reason)}</p>}
                {result.note && <p className="text-[13px] text-white/65">{result.note}</p>}
              </div>
            )}
          </div>
        </div>
      </div>)}
    </Card>
  );
}
