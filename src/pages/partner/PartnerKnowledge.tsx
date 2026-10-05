/**
 * Partner portal -> Ava -> What Ava says. Eli sees every fact RoofGuard Ava is allowed to say on a call (read-only) and can
 * suggest new ones. A suggestion is stored as pending + inactive and Jared approves it before Ava can use it (migration
 * 20261005130000_ava_knowledge_partner.sql; docs/ava-knowledge.md). Everything goes through RPCs, never the table.
 * Hard-rule warnings (src/lib/roofguardRules.ts) show as he types. They are advice, never a block.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, Plus } from "lucide-react";
import { checkRoofguardFact } from "@/lib/roofguardRules";

type Item = { id: string; topic: string; fact: string; status: "live" | "pending" | "declined"; review_note: string | null; proposed_at: string | null };
type Draft = { id: string | null; topic: string; fact: string };
type RpcErr = { message?: string } | null;

const rpc = <T,>(fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: T | null; error: RpcErr }>)(fn, args);

const BTN = "inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40";
const QUIET = "inline-flex min-h-[2.75rem] items-center rounded-lg px-2 text-sm text-white/65 underline-offset-2 hover:text-white hover:underline disabled:opacity-40";
const FIELD = "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[1.0625rem] text-white outline-none placeholder:text-white/55 focus:border-white/30 bento:bg-[var(--bento-well)]";
const CARD = "rounded-3xl bg-white/[0.03] ring-1 ring-white/10 bento:bg-[var(--bento-well)]";

/** The database raises plain messages tagged "KNOWLEDGE: ". Anything else is shown as a generic line, never a raw error. */
function plain(e: RpcErr, fallback: string): string {
  const m = e?.message ?? "";
  const i = m.indexOf("KNOWLEDGE: ");
  return i >= 0 ? m.slice(i + "KNOWLEDGE: ".length) : fallback;
}
const sent = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

export function AvaKnowledge() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await rpc<Item[]>("ava_knowledge_partner_list");
    if (error) { setLoadErr(true); return; }
    setLoadErr(false); setItems(data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const warnings = useMemo(() => (draft ? checkRoofguardFact(`${draft.topic}. ${draft.fact}`) : []), [draft]);

  const save = async () => {
    if (!draft) return;
    const topic = draft.topic.trim(), fact = draft.fact.trim();
    if (!topic) { setFormErr("Add a topic."); return; }
    if (!fact) { setFormErr("Add what Ava can say."); return; }
    setBusy(true); setFormErr(null);
    const { error } = await rpc("ava_knowledge_propose", { p_topic: topic, p_fact: fact, p_id: draft.id });
    setBusy(false);
    if (error) { setFormErr(plain(error, "That didn't save. Try again in a minute.")); return; }
    setDraft(null);
    setNote(draft.id ? "Updated. Jared reviews it before Ava uses it." : "Sent. Jared reviews it before Ava uses it.");
    void load();
  };

  const withdraw = async (it: Item) => {
    setRowBusy(it.id); setRowErr(null);
    const { error } = await rpc("ava_knowledge_withdraw", { p_id: it.id });
    setRowBusy(null);
    if (error) setRowErr(plain(error, "That didn't go through. Try again in a minute."));
    else setNote("Withdrawn.");
    void load();
  };

  const live = (items ?? []).filter((i) => i.status === "live");
  const mine = (items ?? []).filter((i) => i.status !== "live");

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => { setFormErr(null); setNote(null); setDraft({ id: null, topic: "", fact: "" }); }}
        className={cn(BTN, "min-h-[3rem] w-full bg-emerald-500 text-[#052E1F]")}>
        <Plus className="h-4 w-4" aria-hidden />Suggest something Ava can say</button>

      {note && <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />{note}</p>}
      {rowErr && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{rowErr}</p>}
      {loadErr && <div role="alert" className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load the list. Try again in a minute.</div>}
      {!items && !loadErr && <div className="h-32 animate-pulse rounded-3xl bg-white/[0.03] ring-1 ring-white/10" aria-label="Loading" />}

      {mine.length > 0 && (
        <section aria-label="Your suggestions" className={CARD}>
          <h3 className="px-5 pt-4 text-xs font-semibold uppercase tracking-wider text-white/60">Your suggestions</h3>
          <ul className="divide-y divide-white/5">
            {mine.map((it) => (
              <li key={it.id} className="px-5 py-4">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-[0.9375rem] font-medium text-white">{it.topic}</span>
                  <span className="whitespace-nowrap text-xs text-white/55">{sent(it.proposed_at)}</span>
                </div>
                <p className="mt-0.5 text-sm text-white/60">{it.fact}</p>
                {it.status === "pending" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3">
                    <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200">Waiting on Jared</span>
                    <button type="button" className={QUIET} disabled={rowBusy === it.id} onClick={() => { setFormErr(null); setNote(null); setDraft({ id: it.id, topic: it.topic, fact: it.fact }); }}>Edit</button>
                    <button type="button" className={QUIET} disabled={rowBusy === it.id} onClick={() => void withdraw(it)}>
                      {rowBusy === it.id ? "Withdrawing…" : "Withdraw"}</button>
                  </div>
                ) : (
                  <div className="mt-2">
                    <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/75">Not added</span>
                    {it.review_note && <p className="mt-2 text-sm text-white/75">Jared: {it.review_note}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {items && (
        <section aria-label="What Ava can say" className={CARD}>
          <h3 className="px-5 pt-4 text-xs font-semibold uppercase tracking-wider text-white/60">What Ava can say now</h3>
          {live.length === 0 ? (
            <p className="px-5 py-4 text-sm text-white/60">Nothing yet. Ava takes a message for everything.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {live.map((it) => (
                <li key={it.id} className="px-5 py-3.5">
                  <div className="text-[0.9375rem] font-medium text-white">{it.topic}</div>
                  <p className="mt-0.5 text-sm text-white/60">{it.fact}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Sheet open={!!draft} onOpenChange={(o) => { if (!o && !busy) setDraft(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-md bento:bg-[#F3F2EE]">
          <div className="border-b border-white/[0.06] px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
            <SheetTitle className="text-lg font-semibold text-white">{draft?.id ? "Edit your suggestion" : "Suggest something Ava can say"}</SheetTitle>
            <SheetDescription className="mt-1 text-sm text-white/60">Jared reviews it before Ava uses it. Plain facts only, nothing private.</SheetDescription>
          </div>
          <form className="flex-1 space-y-4 px-5 py-5" onSubmit={(e) => { e.preventDefault(); if (!busy) void save(); }}>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-white/80">Topic</span>
              <input value={draft?.topic ?? ""} maxLength={60} autoComplete="off" placeholder="e.g. Storm response" onChange={(e) => setDraft((d) => d && { ...d, topic: e.target.value })}
                className={cn(FIELD, "h-[3.25rem]")} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-white/80">What Ava can say</span>
              <textarea value={draft?.fact ?? ""} rows={5} maxLength={600} placeholder="One or two plain sentences" onChange={(e) => setDraft((d) => d && { ...d, fact: e.target.value })}
                className={cn(FIELD, "py-3 leading-relaxed")} />
              <span className="mt-1 block text-right text-xs tabular-nums text-white/55"><span className="whitespace-nowrap">{(draft?.fact ?? "").length} / 600</span></span>
            </label>

            {warnings.length > 0 && (
              <div role="status" aria-live="polite" className="space-y-2 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-400/30">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />Heads up on RoofGuard's rules</div>
                <ul className="space-y-1.5 text-sm text-amber-100">
                  {warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
                <p className="text-xs text-amber-100/70">You can still send it. Jared sees this note when he reviews.</p>
              </div>
            )}

            {formErr && <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{formErr}</p>}
            <button type="submit" disabled={busy} className={cn(BTN, "min-h-[3.25rem] w-full bg-emerald-500 text-[1.0625rem] text-[#052E1F]")}>
              {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}{busy ? "Sending…" : draft?.id ? "Save changes" : "Save suggestion"}</button>
            <button type="button" onClick={() => setDraft(null)} disabled={busy} className={cn(QUIET, "w-full justify-center")}>Cancel</button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
