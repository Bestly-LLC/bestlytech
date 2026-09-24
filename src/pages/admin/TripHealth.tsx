/**
 * Trip apps health (admin › Turo › LAX Parking Pass, #health). One board for the LAX + home trip apps:
 * scheduled jobs, guest links, Tesla keys, car buttons, TezLab, the Mac mini helper, reminder emails,
 * errors on guest phones, and the pages/pictures/weather guests load. Each check fixes itself first
 * (trip_health_run every 10 min + trip-health edge function); only what is still broken goes to Scout.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, Wrench, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Check = { check_key: string; label: string; status: "ok" | "warn" | "fail"; detail: string | null; heal_note: string | null; healed_at: string | null; checked_at: string; since: string };
const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });

export function TripHealth() {
  const [rows, setRows] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (run = false) => {
    if (run) setBusy(true);
    const { data, error } = await (supabase.rpc("trip_health_admin" as never, { p_run: run } as never) as unknown as Promise<{ data: Check[] | null; error: { message: string } | null }>);
    if (run) { setBusy(false); toast.success("Checks ran. Web checks finish in about a minute."); window.setTimeout(() => load(false), 45000); }
    if (error) { toast.error(error.message); return; }
    setRows(data ?? []);
  }, []);
  useEffect(() => { load(false); const id = window.setInterval(() => load(false), 60000); return () => window.clearInterval(id); }, [load]);
  const bad = rows?.filter((r) => r.status !== "ok").length ?? 0;
  return (
    <div className={card} id="health">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white bento:text-neutral-900">Trip apps health</p>
          <p className="mt-0.5 text-xs text-white/60 bento:text-neutral-500">Checks every 10 minutes and fixes what it can. Anything it can't fix goes to Scout.</p>
        </div>
        <button type="button" onClick={() => load(true)} disabled={busy} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 text-sm text-white disabled:opacity-50 bento:border-neutral-200 bento:text-neutral-800">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Run now
        </button>
      </div>
      {!rows ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-white/50" /> : (
        <>
          <p className={`mt-3 text-sm font-medium ${bad ? "text-amber-300 bento:text-amber-700" : "text-emerald-300 bento:text-emerald-700"}`}>{bad ? `${bad} need${bad === 1 ? "s" : ""} attention` : "Everything is working"}</p>
          <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-neutral-100">
            {rows.map((r) => (
              <li key={r.check_key} className="flex items-start gap-2.5 py-2.5">
                {r.status === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> : r.status === "warn" ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-white bento:text-neutral-900">{r.label}<span className="ml-2 text-xs text-white/50 bento:text-neutral-400">checked {when(r.checked_at)}</span></p>
                  {r.detail && <p className="mt-0.5 text-xs text-white/70 bento:text-neutral-600">{r.detail}</p>}
                  {r.heal_note && r.healed_at && <p className="mt-0.5 flex items-center gap-1 text-xs text-sky-300 bento:text-sky-700"><Wrench className="h-3 w-3" /> Fixed itself {when(r.healed_at)}: {r.heal_note}</p>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
