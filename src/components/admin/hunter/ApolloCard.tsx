/**
 * The "Apollo" card on the Hunter page. Two separate Apollo accounts, one key each:
 *   Maya  (Bestly's Apollo account)   Vault name apollo_api_key_maya
 *   Reese (RoofGuard's Apollo account) Vault name apollo_api_key_reese
 * Keys are write-only (hunter_apollo_key_put), never shown again. "Test" asks hunter-apollo whether the key works
 * and whether the plan can search over the API (free plans often can't).
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, PlugZap, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { Card, when } from "./shared";

type Owner = "maya" | "reese";
type Slot = { key_saved: boolean; saved_at: string | null; tested_at: string | null; test_ok: boolean | null; test_note: string | null };
const LABEL: Record<Owner, { name: string; who: string }> = {
  maya: { name: "Maya", who: "Bestly's Apollo account" },
  reese: { name: "Reese", who: "RoofGuard's Apollo account" },
};

function KeySlot({ owner, slot, reload }: { owner: Owner; slot: Slot; reload: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  const runTest = async () => {
    setBusy("test");
    try { await supabase.functions.invoke("hunter-apollo", { body: { op: "test", owner } }); } catch { /* shown via status */ }
    setBusy(null); reload();
  };
  const save = async () => {
    if (busy || !key.trim()) return;
    setBusy("save");
    const { error } = await rpcArgs("hunter_apollo_key_put", { p_owner: owner, p_value: key.trim() });
    if (error) { setBusy(null); toast.error(/look like/i.test(error.message ?? "") ? "That doesn't look like an Apollo key." : "Couldn't save the key. Try again."); return; }
    setKey(""); toast.success(`${LABEL[owner].name}'s Apollo key saved to the vault`);
    await runTest();
  };

  const chip = slot.test_ok === true
    ? { tone: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25", text: "Works", Icon: CheckCircle2 }
    : slot.test_ok === false
      ? { tone: "bg-amber-500/10 text-amber-200 ring-amber-500/30", text: "Not working", Icon: AlertTriangle }
      : { tone: "bg-white/[0.05] text-white/75 ring-white/10", text: slot.key_saved ? "Saved" : "No key", Icon: PlugZap };
  const id = `apollo-key-${owner}`;

  return (
    <div className="space-y-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-white">For {LABEL[owner].name}</p>
          <p className="text-[13px] text-white/60">{LABEL[owner].who}</p>
        </div>
        <span role="status" className={cn("inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-[13px] font-semibold ring-1", chip.tone)}>
          <chip.Icon className="h-4 w-4 shrink-0" aria-hidden />{chip.text}
        </span>
      </div>
      {slot.test_note && <p className="text-[13px] leading-relaxed text-white/75">{slot.test_note}</p>}
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label htmlFor={id} className="flex items-center gap-2 text-[14px] font-medium text-white/85">
          <KeyRound className="h-4 w-4 text-white/70" aria-hidden />{slot.key_saved ? "Replace key" : "Paste key"}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id={id} type="password" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
            value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste key, then Save"
            className="h-12 min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3.5 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/50 focus:ring-white/40" />
          <button type="submit" disabled={!!busy || key.trim().length < 12}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-white px-5 text-[15px] font-semibold text-black hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40">
            {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save
          </button>
          {slot.key_saved && (
            <button type="button" onClick={() => void runTest()} disabled={!!busy}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-white/10 px-5 text-[15px] font-semibold text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60">
              {busy === "test" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Test
            </button>
          )}
        </div>
        <p className="text-[12px] text-white/55">
          {slot.key_saved && slot.saved_at ? `Saved ${when(slot.saved_at)}. ` : ""}Goes straight to the Bestly vault, never shown again.
          {slot.tested_at ? ` Last tested ${when(slot.tested_at)}.` : ""}
        </p>
      </form>
    </div>
  );
}

export function ApolloCard() {
  const [st, setSt] = useState<Record<Owner, Slot> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await rpcArgs<Record<Owner, Slot>>("hunter_apollo_status");
    if (error || !data) { setErr("Couldn't load Apollo's status."); return; }
    setErr(null); setSt(data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Card title="Apollo" hint="A lead database. Each phone agent uses its own Apollo account, so credits never mix.">
      {err && <p role="alert" className="mb-3 rounded-xl bg-amber-500/10 p-3 text-[14px] text-amber-100 ring-1 ring-amber-500/30">{err}</p>}
      {!st && !err && <div className="h-[120px] rounded-xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />}
      {st && <div className="space-y-3">{(["maya", "reese"] as Owner[]).map((o) => <KeySlot key={o} owner={o} slot={st[o]} reload={() => void load()} />)}</div>}
    </Card>
  );
}
