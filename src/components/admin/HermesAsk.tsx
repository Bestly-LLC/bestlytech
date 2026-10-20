/**
 * Hermes (Mail Clerk) asks in the existing Needs you list (2026-10-19, Jared).
 *
 * Every paid iPostal1 action (open and scan, shred, forward, recycle, check deposit, package handling) shows up in Needs you as a
 * row keyed `hermes:act:<id>`. This is its one-tap Approve / Not now pair. Approve calls hermes_action_decide (admin only): that is
 * the only door the database has for turning a proposal into something Hermes may run. No new page, no sidebar item.
 */
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const KEY = /^hermes:act:([0-9a-f-]{36})$/i;

/** The ask id inside a Needs you row key, or null for every other row. */
export const hermesAskId = (key: string | null | undefined): string | null => KEY.exec(key ?? "")?.[1] ?? null;

/** Tells every Needs you list on screen to reload. */
export const HERMES_DECIDED = "hermes:decided";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

export async function decideHermesAsk(id: string, approve: boolean): Promise<boolean> {
  const { error } = await rpc("hermes_action_decide", { p_id: id, p_approve: approve });
  if (error) {
    toast.error(approve ? "Couldn't approve that" : "Couldn't update that", { description: error.message });
    return false;
  }
  toast.success(approve ? "Approved. Hermes does it on its next pass, within 5 minutes." : "Left alone. Nothing was spent.");
  window.dispatchEvent(new Event(HERMES_DECIDED));
  return true;
}

export function HermesAskButtons({ id, onDone, className }: { id: string; onDone?: () => void; className?: string }) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const run = async (approve: boolean) => {
    setBusy(approve ? "yes" : "no");
    const ok = await decideHermesAsk(id, approve);
    setBusy(null);
    if (ok) onDone?.();
  };
  const pill = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[0.8125rem] font-semibold transition-[transform,opacity] duration-150 active:scale-[0.97] disabled:opacity-50 sm:min-h-9";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <button type="button" disabled={busy !== null} onClick={() => run(true)} className={cn(pill, "bg-white text-black")}>
        {busy === "yes" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        Approve
      </button>
      <button type="button" disabled={busy !== null} onClick={() => run(false)}
        className={cn(pill, "border border-white/15 font-medium text-white hover:bg-white/[0.06]")}>
        {busy === "no" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        Not now
      </button>
    </span>
  );
}
