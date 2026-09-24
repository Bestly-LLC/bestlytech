/** Command Center widget: Turo Watch at a glance (car, who has it, must-return charge, next trip, unbilled Supercharging). */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BatteryCharging, Car, ChevronRight, Lock, LockOpen, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { LoadError, SectionHeader, cardCls, focusRing, text, tint } from "@/components/admin/ui";

type W = {
  car: string; battery: number | null; range: number | null; locked: boolean | null; charging: string | null; observed_at: string | null;
  current: { guest: string | null; ends_at: string; return_pct: number | null } | null;
  next: { guest: string | null; starts_at: string; earnings: number | null } | null; owed: number; alerts: number;
};
/** 12-hour, LA time: "Thu 3:05 PM". */
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });

function Stat({ label, value, detail, valueClass }: { label: string; value: React.ReactNode; detail: React.ReactNode; valueClass?: string }) {
  return (
    <div className="min-w-0">
      <p className={text.detail}>{label}</p>
      <p className={cn(text.stat, "truncate", valueClass)}>{value}</p>
      <p className={cn(text.detail, "flex items-center gap-1 truncate")}>{detail}</p>
    </div>
  );
}

export function TuroMini() {
  const [w, setW] = useState<W | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    const { data, error } = await (supabase.rpc("turo_widget" as never) as unknown as Promise<{ data: W | null; error: unknown }>);
    setBusy(false);
    if (error || !data) { setFailed(true); return; }
    setFailed(false); setW(data);
  }, []);
  useEffect(() => {
    load(); const id = window.setInterval(load, 120000); return () => window.clearInterval(id);
  }, [load]);

  const header = <SectionHeader id="turo-title" title="Turo" icon={<Car className="h-3.5 w-3.5" aria-hidden />} aside={w?.car} />;

  if (!w) {
    return (
      <section aria-labelledby="turo-title">
        {header}
        {failed
          ? <div className={cn(cardCls, "p-4 sm:p-6")}><LoadError label="Turo" onRetry={load} busy={busy} /></div>
          : <div className={cn(cardCls, "h-[120px] animate-pulse")} aria-label="Loading Turo" />}
      </section>
    );
  }
  const low = w.current?.return_pct != null && w.battery != null && w.battery < w.current.return_pct;
  const charging = w.charging && !["Disconnected", "Stopped"].includes(w.charging);
  return (
    <section aria-labelledby="turo-title">
      {header}
      <Link to="/admin/turo" aria-label={`Open Turo Watch for ${w.car}`}
        className={cn(cardCls, "group flex items-center gap-4 p-4 transition-colors hover:border-white/15 sm:p-6", focusRing)}>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <Stat
            label="Battery"
            value={<>{w.battery ?? "–"}%{w.range ? <span className="ml-1 text-[13px] font-normal text-white/60">{Math.round(w.range)} mi</span> : null}</>}
            detail={charging
              ? <><BatteryCharging className="h-3.5 w-3.5 shrink-0" aria-hidden />{w.charging}</>
              : w.locked === false
                ? <><LockOpen className={cn("h-3.5 w-3.5 shrink-0", tint.orange)} aria-hidden /><span className={tint.orange}>Unlocked</span></>
                : <><Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />Locked</>}
          />
          <Stat
            label={w.current ? "Out now" : "Car"}
            value={w.current ? w.current.guest ?? "Guest" : "Home"}
            detail={w.current ? `Back ${when(w.current.ends_at)}` : "No one has it"}
          />
          {w.current ? (
            <Stat
              label="Return at"
              value={w.current.return_pct != null ? `${w.current.return_pct}%+` : "–"}
              valueClass={low ? tint.orange : undefined}
              detail={low ? "Below it now" : "Level at trip start"}
            />
          ) : (
            <Stat label="Next trip" value={w.next?.guest ?? "None"} detail={w.next ? when(w.next.starts_at) : "Nothing booked"} />
          )}
          <Stat
            label="Supercharging"
            value={<span className="inline-flex items-center gap-1"><Zap className="h-4 w-4 shrink-0" aria-hidden />{w.owed > 0 ? `$${w.owed.toFixed(2)}` : "All billed"}</span>}
            valueClass={w.owed > 0 ? tint.red : tint.green}
            detail={w.owed > 0 ? "Not requested in Turo" : `${w.alerts} car alert${w.alerts === 1 ? "" : "s"} today`}
          />
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition-colors group-hover:text-white/70" aria-hidden />
      </Link>
    </section>
  );
}
