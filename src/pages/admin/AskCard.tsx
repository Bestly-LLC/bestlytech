/**
 * Guest helper ("Ask a question" on the guest page).
 *   GuestHelperCard  (LAX Parking Pass page): this week's numbers, recent questions, and the Rules sheet
 *                    (add / edit / delete the house rules the helper follows).
 *   HelperSettings   (Trip settings page): show-to-guests switch and the free AI chain
 *                    Gemini -> Groq -> Mac mini -> FAQ, with the Gemini key box (straight to Vault).
 * House rules are stored as one rule per line in lax_ask_settings.house_rules (the helper reads the text as-is).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ListChecks, Loader2, MessageCircleQuestion, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Sheet, Switch, btnPlain, btnPrimary, btnTinted, card, field, label, pill, secondary, separator, tertiary, tint } from "./laxUi";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

type Row = { at: string; q: string; a: string | null; source: string | null; unanswered: boolean; urgent: boolean; shared: boolean };
export type HelperState = {
  enabled: boolean; daily_limit: number; house_rules: string | null; gemini_key: boolean; gemini_model: string;
  gemini_ok_at: string | null; gemini_error: string | null; gemini_error_at: string | null;
  groq_key?: boolean; groq_ok_at?: string | null; groq_error?: string | null; groq_error_at?: string | null;
  local_online: boolean; local_ok_at: string | null; local_error: string | null;
  week: { asked: number; gemini: number; groq?: number; local: number; faq: number; unanswered: number }; recent: Row[];
};
const when = (s: string | null | undefined) => s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" }) : "never";
const SRC: Record<string, string> = { gemini: "Gemini", groq: "Groq", local: "Mac mini", faq: "FAQ" };
const srcName = (s: string | null) => (s ? SRC[s.replace(/-agent$/, "")] ?? s : "pending") + (s?.endsWith("-agent") ? " (fixed something)" : "");

function useHelper() {
  const [st, setSt] = useState<HelperState | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await rpc("lax_ask_admin_state");
    if (!error && data) setSt(data as HelperState);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { st, load };
}

const toRules = (text: string | null) =>
  (text ?? "").split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);

/* ─────────────── Rules sheet ─────────────── */

function RulesSheet({ open, onClose, text, onSaved }: { open: boolean; onClose: () => void; text: string | null; onSaved: () => void }) {
  const [rules, setRules] = useState<string[]>(toRules(text));
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const addRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) { setRules(toRules(text)); setEditing(null); setAdding(""); } }, [open, text]);

  const persist = async (next: string[], msg: string, undo?: string[]): Promise<boolean> => {
    setSaving(true);
    const { error } = await rpc("lax_ask_admin_set", { p_house_rules: next.join("\n") });
    setSaving(false);
    if (error) { toast.error(error.message); return false; }
    setRules(next);
    onSaved();
    toast.success(msg, undo ? { action: { label: "Undo", onClick: () => { persist(undo, "Rule restored."); } } } : undefined);
    return true;
  };
  const add = async () => {
    const t = adding.trim().replace(/\s+/g, " ");
    if (!t) return;
    if (await persist([...rules, t], "Rule added. The helper uses it on the next question.")) { setAdding(""); addRef.current?.focus(); }
  };
  const saveEdit = async (i: number) => {
    const t = draft.trim().replace(/\s+/g, " ");
    if (!t) return;
    if (await persist(rules.map((r, j) => (j === i ? t : r)), "Rule updated.")) setEditing(null);
  };
  const remove = (i: number) => persist(rules.filter((_, j) => j !== i), "Rule deleted.", rules);

  return (
    <Sheet open={open} onClose={onClose} title="Helper rules"
      footer={
        <div className="space-y-2">
          <label htmlFor="new-rule" className={cn("block text-[13px] font-medium", secondary)}>New rule</label>
          <div className="flex items-end gap-2">
            <textarea id="new-rule" ref={addRef} rows={2} value={adding} maxLength={400} onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } }}
              placeholder="e.g. Return with at least 40% charge." className={cn(field, "resize-none")} />
            <button type="button" onClick={add} disabled={saving || !adding.trim()} className={cn(btnPrimary, "shrink-0 px-4")} aria-label="Add rule">
              {saving && editing === null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
            </button>
          </div>
        </div>
      }>
      <p className={cn("mb-3 text-[13px] leading-snug", secondary)}>The helper follows these on every answer. Keep each one short and plain.</p>
      {rules.length === 0 ? (
        <div className={cn(card, "py-8 text-center")}>
          <ListChecks className={cn("mx-auto h-7 w-7", tertiary)} aria-hidden />
          <p className={cn("mt-2 text-[15px] font-medium", label)}>No rules yet</p>
          <p className={cn("mt-1 text-[13px]", secondary)}>Add the first one below, like "No smoking or vaping."</p>
        </div>
      ) : (
        <ol className={cn(card, "divide-y p-0", separator)}>
          {rules.map((r, i) => (
            <li key={i} className="px-4 py-3">
              {editing === i ? (
                <div className="space-y-2">
                  <textarea rows={2} autoFocus value={draft} maxLength={400} onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(i); } if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }}
                    aria-label={`Edit rule ${i + 1}`} className={cn(field, "resize-none")} />
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={() => setEditing(null)} className={btnPlain}>Cancel</button>
                    <button type="button" onClick={() => saveEdit(i)} disabled={saving || !draft.trim()} className={cn(btnTinted, "px-4")}>
                      {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className={cn("mt-[1px] w-5 shrink-0 text-right text-[15px] tabular-nums", tertiary)}>{i + 1}.</span>
                  <p className={cn("min-w-0 flex-1 text-[15px] leading-snug", label)}>{r}</p>
                  <div className="-my-2 flex shrink-0">
                    <button type="button" onClick={() => { setEditing(i); setDraft(r); }} aria-label={`Edit rule ${i + 1}`}
                      className={cn("grid h-11 w-11 place-items-center rounded-full hover:bg-[#ffffff0f] bento:hover:bg-[#0000000a]", tint.blue)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => remove(i)} disabled={saving} aria-label={`Delete rule ${i + 1}`}
                      className={cn("grid h-11 w-11 place-items-center rounded-full hover:bg-[#ffffff0f] bento:hover:bg-[#0000000a]", tint.red)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}

/* ─────────────── Main page card ─────────────── */

export function GuestHelperCard() {
  const { st, load } = useHelper();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (!st) return null;
  const rules = toRules(st.house_rules);
  const w = st.week;
  const shown = all ? st.recent : st.recent.slice(0, 4);
  return (
    <div id="ask" className={cn(card, "space-y-4")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <MessageCircleQuestion className={cn("mt-1 h-5 w-5 shrink-0", tint.blue)} aria-hidden />
          <div className="min-w-0">
            <p className={cn("text-[17px] font-semibold", label)}>Ask a question</p>
            <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
              {st.enabled ? "On the guest page" : "Hidden from guests"} · {w.asked} asked this week{w.unanswered ? ` · ${w.unanswered} sent to you` : ""}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setRulesOpen(true)} className={cn(btnTinted, "shrink-0 px-4")}>
          <ListChecks className="h-4 w-4" aria-hidden /> Rules{rules.length ? ` (${rules.length})` : ""}
        </button>
      </div>

      {st.recent.length === 0 ? (
        <p className={cn("text-[15px]", secondary)}>No questions yet.</p>
      ) : (
        <>
          <ul className={cn("divide-y", separator)}>
            {shown.map((r, i) => (
              <li key={i} className="py-3 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <p className={cn("text-[15px] font-semibold leading-snug", label)}>{r.q}</p>
                  {(r.urgent || r.unanswered) && (
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", pill.orange)}>{r.urgent ? "Urgent" : "Sent to you"}</span>
                  )}
                </div>
                <p className={cn("mt-1 text-[13px] leading-snug", secondary)}>{r.a || "Answering…"}</p>
                <p className={cn("mt-1 text-[12px]", tertiary)}>{when(r.at)} · {srcName(r.source)}</p>
              </li>
            ))}
          </ul>
          {st.recent.length > 4 && (
            <button type="button" onClick={() => setAll((v) => !v)} className={btnPlain}>
              {all ? "Show fewer" : `Show all ${st.recent.length}`}
            </button>
          )}
        </>
      )}
      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} text={st.house_rules} onSaved={load} />
    </div>
  );
}

/* ─────────────── Settings page ─────────────── */

export function HelperSettings() {
  const { st, load } = useHelper();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  if (!st) return <div className={cn(card, "h-40 animate-pulse")} aria-label="Loading" />;

  const saveKey = async () => {
    setBusy(true);
    const { error } = await rpc("lax_ask_set_gemini_key", { p_key: key.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    setKey(""); setShowKey(false); toast.success("Saved to Vault. Gemini answers first from now on."); load();
  };
  const toggle = async (on: boolean) => {
    const { error } = await rpc("lax_ask_admin_set", { p_enabled: on });
    if (error) toast.error(error.message); else { toast.success(on ? "Helper is on the guest page." : "Helper is hidden from guests."); load(); }
  };

  const failing = (ok?: string | null, err?: string | null, errAt?: string | null) => !!err && (!ok || (errAt ?? "") > ok);
  const gemFail = failing(st.gemini_ok_at, st.gemini_error, st.gemini_error_at);
  const groqFail = failing(st.groq_ok_at, st.groq_error, st.groq_error_at);
  const short = (e: string | null | undefined) => {
    const m = (e ?? "").match(/\b(429|503|500|401|403)\b/);
    return m?.[1] === "429" ? "Over Google's free limit for now" : m?.[1] === "503" ? "Google is busy right now" : m?.[1] === "401" || m?.[1] === "403" ? "Key was rejected" : (e ?? "").replace(/^Error:\s*/, "").slice(0, 90);
  };
  const w = st.week;
  const rungs: { name: string; ok: boolean; detail: string; count?: number }[] = [
    { name: "Gemini", ok: st.gemini_key && !gemFail, count: w.gemini,
      detail: !st.gemini_key ? "No key. Add one below." : gemFail ? `${short(st.gemini_error)} · ${when(st.gemini_error_at)}. Groq answers meanwhile.` : `Working · last answer ${when(st.gemini_ok_at)}` },
    { name: "Groq", ok: !!st.groq_key && !groqFail, count: w.groq ?? 0,
      detail: !st.groq_key ? "No key in Vault." : groqFail ? `${short(st.groq_error)} · ${when(st.groq_error_at)}` : `Working${st.groq_ok_at ? ` · last answer ${when(st.groq_ok_at)}` : ""}` },
    { name: "Mac mini", ok: st.local_online, count: w.local,
      detail: st.local_online ? `Online · last answer ${when(st.local_ok_at)}` : `Offline${st.local_error ? `: ${st.local_error}` : ""}` },
    { name: "FAQ", ok: true, count: w.faq, detail: "Always on. Answers if the others can't within 50 seconds." },
  ];

  return (
    <div className="space-y-3">
      <div className={cn(card, "py-2")}>
        <Switch checked={st.enabled} onChange={toggle} label="Show the helper to guests"
          detail={`${st.daily_limit} questions per guest per day.`} />
      </div>
      <div className={cn(card, "p-0")}>
        <p className={cn("px-5 pt-4 text-[13px]", secondary)}>Tries each in order, all free. Answers this week in brackets.</p>
        <ol className={cn("divide-y", separator)}>
          {rungs.map((r, i) => (
            <li key={r.name} className="flex items-start gap-3 px-5 py-3">
              {r.ok ? <CheckCircle2 className={cn("mt-0.5 h-5 w-5 shrink-0", tint.green)} aria-label="Working" />
                : <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", tint.orange)} aria-label="Needs attention" />}
              <div className="min-w-0 flex-1">
                <p className={cn("text-[15px] font-medium", label)}>{i + 1}. {r.name} <span className={cn("font-normal tabular-nums", tertiary)}>({r.count ?? 0})</span></p>
                <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>{r.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className={cn(card, "space-y-3")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className={cn("text-[15px] font-medium", label)}>Gemini key</p>
            <p className={cn("mt-0.5 text-[13px]", secondary)}>{st.gemini_key ? "Saved in Vault. Can't be read back here." : "Not set."} Model: {st.gemini_model}</p>
          </div>
          {!showKey && <button type="button" onClick={() => setShowKey(true)} className={btnPlain}>{st.gemini_key ? "Replace" : "Add"}</button>}
        </div>
        {showKey && (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste a Gemini API key" aria-label="Gemini API key" className={field} />
              <button type="button" onClick={saveKey} disabled={busy || key.trim().length < 20} className={cn(btnPrimary, "shrink-0")}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save to Vault
              </button>
            </div>
            <p className={cn("text-[12px]", tertiary)}>Free keys: aistudio.google.com/app/apikey. On Google's free tier, Google may use questions to improve its products.</p>
            <button type="button" onClick={() => { setShowKey(false); setKey(""); }} className={btnPlain}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
