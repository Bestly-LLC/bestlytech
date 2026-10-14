/**
 * In-car welcome card: how many guests scan the QR on the card left with the free water, and who got into their trip
 * from it. Data: card_scans via card_scans_admin (migration 20261012050000). Scans come from /turo-key?src=card
 * (Home + LAX cards) and /turo-key?src=delivery (the cream card left on delivered cars).
 * Jared's own test scans show as "Your test" in the list and never count. Watchdog: Card QR Watch (tool of Leo).
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { LoadError, SectionHeader, cardCls, text } from "@/components/admin/ui";
import { Lines } from "@/components/Lines";

type Row = { scanned_at: string; signed_in_at: string | null; kind: string; device: string | null; src: string; reservation_id: number | null; guest_first: string | null };
type Data = { week: number; month: number; all: number; signed: number; trips: number; last: string | null; cleared_at?: string | null; recent: Row[] };

const at12 = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });

export function CardScans() {
  const [d, setD] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    const { data, error } = await (supabase.rpc("card_scans_admin" as never, { p_limit: 12 } as never) as unknown as Promise<{ data: Data | null; error: unknown }>);
    if (error || !data) { setFailed(true); return; }
    setD(data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const [clearing, setClearing] = useState(false);
  // Hides every scan in the list and resets the counts (Jared's own tests). Nothing is erased: card_scans.cleared_at.
  const clear = async () => {
    if (!window.confirm("Clear all card scans?\nThe list and the counts start over from now.")) return;
    setClearing(true);
    const { data, error } = await (supabase.rpc("card_scans_clear" as never) as unknown as Promise<{ data: { cleared: number } | null; error: { message: string } | null }>);
    setClearing(false);
    if (error) { toast.error(error.message); return; }
    toast.success(data?.cleared ? `Cleared ${data.cleared} scan${data.cleared === 1 ? "" : "s"}.` : "Nothing to clear.");
    void load();
  };

  const pct = d && d.all ? Math.round((d.signed / d.all) * 100) : null;
  const stats: [string, string][] = d ? [["This week", String(d.week)], ["30 days", String(d.month)], ["Got into their trip", pct == null ? "–" : `${d.signed} (${pct}%)`]] : [];

  return (
    <section aria-labelledby="card-scans-title" id="card-scans" className="scroll-mt-24">
      <SectionHeader id="card-scans-title" title="In-car card" icon={<QrCode className="h-3.5 w-3.5" aria-hidden />} aside={<>
        <span>{d?.last ? `Last scan ${at12(d.last)}` : "QR scans"}</span>
        <button type="button" onClick={() => void clear()} disabled={clearing || !d || d.recent.length === 0}
          title={d && d.recent.length === 0 ? "Nothing to clear" : "Clear all card scans"}
          className="-my-2 ml-2 min-h-[44px] rounded-full px-2 text-[13px] font-semibold text-[#0A84FF] disabled:text-white/30">
          {clearing ? "Clearing…" : "Clear"}
        </button>
      </>} />
      <div className={cn(cardCls, "overflow-hidden")}>
        {failed ? <div className="p-4 sm:p-6"><LoadError label="card scans" onRetry={load} /></div>
          : !d ? <div className="h-48 animate-pulse" />
          : (
            <>
              <div className="grid grid-cols-3 divide-x divide-white/[0.06] border-b border-white/[0.06]">
                {stats.map(([k, v]) => (
                  <div key={k} className="px-4 py-3 sm:px-5">
                    <p className={cn(text.meta, "uppercase tracking-wide")}>{k}</p>
                    <p className="mt-1 whitespace-nowrap text-[22px] font-semibold tabular-nums text-white">{v}</p>
                  </div>
                ))}
              </div>
              {d.recent.length === 0
                ? <p className={cn(text.detail, "px-4 py-5 sm:px-5")}><Lines>{d.cleared_at ? `No scans since you cleared the list on ${at12(d.cleared_at)}. New ones show up here the moment a guest scans the card in the car.` : "No scans yet. They show up here the moment a guest scans the card in the car."}</Lines></p>
                : (
                  <ul className="divide-y divide-white/[0.06]">
                    {d.recent.map((r) => {
                      const host = r.src === "host";
                      const who = host ? "Your test" : r.guest_first ? r.guest_first : r.signed_in_at ? "Signed in" : "Scanned, didn't sign in";
                      return (
                        <li key={r.scanned_at + (r.device ?? "")} className="flex min-h-[48px] items-center gap-3 px-4 py-2 sm:px-5">
                          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", host ? "bg-white/30" : r.signed_in_at ? "bg-[#30D158]" : "bg-[#FFD60A]")} aria-hidden />
                          <span className="min-w-0 flex-1 text-[15px] text-white">{who}
                            {r.device && <span className="text-white/50"> · {r.device}</span>}
                            {r.src === "delivery" ? <span className="text-white/50"> · Delivery</span> : r.kind === "lax" && <span className="text-white/50"> · LAX</span>}</span>
                          <span className="shrink-0 whitespace-nowrap text-[13px] tabular-nums text-white/50">{at12(r.scanned_at)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </>
          )}
      </div>
    </section>
  );
}
