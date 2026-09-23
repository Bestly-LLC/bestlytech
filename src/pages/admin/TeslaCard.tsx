import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Bound call: supabase.rpc unbound loses `this` ("reading 'rest'").
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";

type TState = { client_id: string | null; has_secret: boolean; enabled: boolean; monthly_cap_usd: number; per_trip_cap_usd: number; spent_usd: number };

/** Tesla Fleet API: paste the Client Secret once. It goes straight into Supabase Vault and can't be read back here. */
export function TeslaCard() {
  const [st, setSt] = useState<TState | null>(null);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await rpc("tesla_fleet_admin_state");
    if (!error) setSt(data as TState);
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setSaving(true);
    const { error } = await rpc("tesla_fleet_set_secret", { p_secret: secret });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setSecret("");
    toast.success("Saved to Vault.");
    load();
  };
  if (!st) return null;
  return (
    <div className={cn(card, "space-y-3")}>
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-4 w-4 text-violet-300 bento:text-violet-600" />
        <div>
          <p className="text-sm font-medium text-white bento:text-neutral-900">Tesla car controls</p>
          <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500">
            Free-only: stops at ${Number(st.monthly_cap_usd).toFixed(2)}/month (Tesla gives $10 free). This month: ${Number(st.spent_usd).toFixed(2)}.
          </p>
        </div>
      </div>
      {st.has_secret ? (
        <p className="flex items-center gap-2 text-sm text-emerald-300 bento:text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Client Secret is saved in Vault.</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)}
            placeholder="Paste the Tesla Client Secret"
            className="w-full rounded-lg border border-white/10 bg-transparent px-2.5 py-2 text-sm text-white bento:border-neutral-200 bento:text-neutral-900" />
          <button type="button" onClick={save} disabled={saving || secret.trim().length < 10}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save to Vault
          </button>
        </div>
      )}
    </div>
  );
}

/** Jared's own Wallet pass: blue-hour art, no guest info, same lock-screen suggestions. Add once; it updates itself each month. */
export function HostPassCard() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { rpc("lax_pass_host_url").then(({ data }) => setUrl((data as string) ?? null)); }, []);
  if (!url) return null;
  return (
    <div className={cn(card, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
      <div className="flex items-start gap-3">
        <Wallet className="mt-0.5 h-4 w-4 text-teal-300 bento:text-teal-600" />
        <div>
          <p className="text-sm font-medium text-white bento:text-neutral-900">My host pass</p>
          <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500">Your own garage pass. Add it once on your iPhone; the new code lands in it on the 1st, when you save it here.</p>
        </div>
      </div>
      <a href={url} className="inline-flex shrink-0 items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black hover:bg-white/90 bento:bg-[#111114] bento:text-white bento:hover:bg-[#2a2a30]">Add my pass to Apple Wallet</a>
    </div>
  );
}
