/**
 * TezLab: guest car buttons (A/C, honk, flash) go through Jared's TezLab allowance first; Tesla Fleet API is the backup.
 * Shows whether it's working, tests it, and reconnects it (one tap -> TezLab sign-in -> back here).
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, PlugZap, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { btnPlain, btnTinted, card, label, secondary } from "./laxUi";

type St = { connected: boolean; enabled: boolean; connected_at: string | null; last_ok_at: string | null; last_error: string | null; last_error_at: string | null; via_tezlab_30d: number };
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" }) : "never";

export function TezLabCard() {
  const [st, setSt] = useState<St | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await (supabase.rpc("tezlab_admin_state" as never) as unknown as Promise<{ data: St | null }>);
    setSt(data);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const call = async (op: "status" | "start") => {
    setBusy(op);
    const { data, error } = await supabase.functions.invoke("tezlab", { body: { op } });
    setBusy(null);
    const d = data as { ok?: boolean; url?: string; error?: string } | null;
    if (error || d?.error) { toast.error(d?.error ?? error?.message ?? "TezLab didn't answer"); void load(); return; }
    if (op === "start" && d?.url) { window.location.href = d.url; return; }
    toast.success("TezLab is working: it just read the car.");
    void load();
  };
  if (!st) return <div className={cn(card, "h-24 animate-pulse")} aria-label="Loading" />;
  const failing = !!st.last_error_at && (!st.last_ok_at || st.last_error_at > st.last_ok_at);
  return (
    <div id="tezlab" className={cn(card, "space-y-3 scroll-mt-24")}>
      <div className="flex items-start gap-3">
        {!st.connected ? <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-[#FF9F0A]" aria-hidden />
          : failing ? <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#FF9F0A]" aria-hidden />
          : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#30D158]" aria-hidden />}
        <div className="min-w-0">
          <p className={cn("text-[17px] font-semibold", label)}>
            {!st.connected ? "TezLab isn't connected" : failing ? "TezLab hiccup, Tesla backup is covering" : "TezLab is working"}
          </p>
          <p className={cn("mt-0.5 text-[14px] leading-snug", secondary)}>
            Last worked {when(st.last_ok_at)} · {st.via_tezlab_30d} guest command{st.via_tezlab_30d === 1 ? "" : "s"} in 30 days.
            {failing && st.last_error ? <> Last error {when(st.last_error_at)}: {st.last_error.replace(/^Error: /, "").slice(0, 120)}</> : null}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void call("status")} disabled={!!busy || !st.connected} className={cn(btnTinted, "h-auto")}>
          {busy === "status" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" aria-hidden />} Test it
        </button>
        <button type="button" onClick={() => void call("start")} disabled={!!busy} className={cn(btnPlain, "h-auto")}>
          {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" aria-hidden />} {st.connected ? "Reconnect" : "Connect TezLab"}
        </button>
      </div>
    </div>
  );
}
