import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { card, field } from "./laxUi";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

const muted = "text-xs text-white/60 bento:text-neutral-600";
const btn = "inline-flex items-center gap-1.5 rounded-full bg-[#111114] px-4 py-2 text-xs font-medium text-[#fff] ring-1 ring-[#ffffff26] disabled:opacity-60";
const input = field;

type Row = { at: string; q: string; a: string | null; source: string | null; unanswered: boolean; urgent: boolean; shared: boolean };
type St = {
  enabled: boolean; daily_limit: number; house_rules: string | null; gemini_key: boolean; gemini_model: string;
  gemini_ok_at: string | null; gemini_error: string | null; gemini_error_at: string | null;
  local_online: boolean; local_ok_at: string | null; local_error: string | null;
  week: { asked: number; gemini: number; local: number; faq: number; unanswered: number }; recent: Row[];
};
const when = (s: string | null) => s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "never";
const SRC: Record<string, string> = { gemini: "Gemini", local: "Mac mini", faq: "FAQ" };

/** Guest "Ask a question" helper: status of each free rung, Gemini key box (Vault), house rules, recent questions. */
export function AskCard() {
  const [st, setSt] = useState<St | null>(null);
  const [key, setKey] = useState("");
  const [rules, setRules] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await rpc("lax_ask_admin_state");
    if (!error && data) { setSt(data as St); setRules((r) => r ?? ((data as St).house_rules ?? "")); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!st) return null;

  const saveKey = async () => {
    setBusy(true);
    const { error } = await rpc("lax_ask_set_gemini_key", { p_key: key });
    setBusy(false);
    if (error) return toast.error(error.message);
    setKey(""); toast.success("Saved to Vault. Gemini answers first from now on."); load();
  };
  const saveRules = async () => {
    setBusy(true);
    const { error } = await rpc("lax_ask_admin_set", { p_house_rules: rules ?? "" });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("House rules saved. The helper uses them on the next question.");
  };
  const toggle = async (on: boolean) => {
    const { error } = await rpc("lax_ask_admin_set", { p_enabled: on });
    if (error) toast.error(error.message); else load();
  };

  const gemFail = !!st.gemini_error && (!st.gemini_ok_at || (st.gemini_error_at ?? "") > st.gemini_ok_at);
  const rung = (label: string, ok: boolean, detail: string) => (
    <p className="flex items-start gap-2 text-sm text-white bento:text-neutral-900">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400 bento:text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400 bento:text-amber-600" />}
      <span><b>{label}</b> <span className={muted}>{detail}</span></span>
    </p>
  );

  return (
    <div id="ask" className={cn(card, "space-y-4")}>
      <div className="flex items-start gap-3">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 text-[#409CFF] bento:text-[#007AFF]" />
        <div>
          <p className="text-[17px] font-semibold text-white bento:text-neutral-900">Guest helper: Ask a question</p>
          <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500">
            Free chat on the guest page. Last 7 days: {st.week.asked} asked · {st.week.gemini} Gemini · {st.week.local} Mac mini · {st.week.faq} FAQ · {st.week.unanswered} sent to you.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {rung("1. Gemini (free tier)", st.gemini_key && !gemFail,
          !st.gemini_key ? "No key yet. Paste one below to turn it on." : gemFail ? `Last error ${when(st.gemini_error_at)}: ${st.gemini_error}` : `Last answer ${when(st.gemini_ok_at)}`)}
        {rung("2. Mac mini (qwen3, local)", st.local_online, st.local_online ? `Online · last answer ${when(st.local_ok_at)}` : `Offline${st.local_error ? `: ${st.local_error}` : ""}`)}
        {rung("3. FAQ", true, "Always on. Kicks in if 1 and 2 can't answer within 50 seconds.")}
      </div>

      {!st.gemini_key && (
        <div className="space-y-2">
          <p className={muted}>Optional, faster answers: get a free key at <a className="underline" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">aistudio.google.com/app/apikey</a> and paste it here. It goes straight into Vault. Note: on Google's free tier, Google may use the questions to improve its products.</p>
          <div className="flex gap-2">
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Gemini API key" className={input} />
            <button type="button" onClick={saveKey} disabled={busy || key.trim().length < 20} className={btn}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[15px] font-semibold text-white bento:text-neutral-900">House rules the helper should know</p>
        <textarea rows={4} value={rules ?? ""} onChange={(e) => setRules(e.target.value)} className={input}
          placeholder={"e.g. No smoking or vaping. Pets OK with a crate. Return with at least 40% charge. Charging cable is in the frunk."} />
        <button type="button" onClick={saveRules} disabled={busy} className={btn}>Save rules</button>
      </div>

      <label className="flex items-center gap-2 text-sm text-white bento:text-neutral-900">
        <input type="checkbox" checked={st.enabled} onChange={(e) => toggle(e.target.checked)} className="h-4 w-4" />
        Show the helper to guests ({st.daily_limit} questions per guest per day)
      </label>

      {st.recent.length > 0 && (
        <div className="space-y-2">
          <p className="text-[15px] font-semibold text-white bento:text-neutral-900">Recent questions</p>
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {st.recent.map((r, i) => (
              <li key={i} className={cn("rounded-xl p-3 ring-1", r.urgent ? "ring-red-400/60" : r.unanswered ? "ring-amber-400/50" : "ring-white/10 bento:ring-neutral-200")}>
                <p className="text-[15px] font-semibold text-white bento:text-neutral-900">{r.q}</p>
                <p className="mt-1 text-xs text-white/70 bento:text-neutral-700">{r.a || "…"}</p>
                <p className="mt-1 text-[11px] text-white/45 bento:text-neutral-500">
                  {when(r.at)} · {r.source ? SRC[r.source] ?? r.source : "pending"}{r.shared ? " · shared link" : " · personal link"}{r.unanswered ? " · couldn't answer" : ""}{r.urgent ? " · urgent" : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
