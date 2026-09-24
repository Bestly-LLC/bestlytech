/** Command Center widget: Turo Watch at a glance (car, who has it, must-return charge, next trip, unbilled Supercharging). */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BatteryCharging, Car, ChevronRight, Lock, LockOpen, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type W = {
  car: string; battery: number | null; range: number | null; locked: boolean | null; charging: string | null; observed_at: string | null;
  current: { guest: string | null; ends_at: string; return_pct: number | null } | null;
  next: { guest: string | null; starts_at: string; earnings: number | null } | null; owed: number; alerts: number;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });

export function TuroMini() {
  const [w, setW] = useState<W | null>(null);
  useEffect(() => {
    const load = () => void (supabase.rpc("turo_widget" as never) as unknown as Promise<{ data: W | null }>).then(({ data }) => data && setW(data));
    load(); const id = window.setInterval(load, 120000); return () => window.clearInterval(id);
  }, []);
  if (!w) return <div className="h-[132px] animate-pulse rounded-2xl bg-white/[0.03] bento:rounded-[1.75rem] bento:bg-[#fff]" aria-label="Loading Turo" />;
  const low = w.current?.return_pct != null && w.battery != null && w.battery < w.current.return_pct;
  return (
    <Link to="/admin/turo" aria-label="Open Turo Watch"
      className="group block rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 transition-colors hover:border-white/15 bento:rounded-[1.75rem] bento:border-transparent bento:bg-[#fff] sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-widest text-white/55 bento:text-neutral-500"><Car className="h-4 w-4" aria-hidden /> Turo Watch · {w.car}</p>
        <ChevronRight className="h-4 w-4 text-white/40 transition-colors group-hover:text-white/80" aria-hidden />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-white/50 bento:text-neutral-500">Battery</p>
          <p className="text-lg font-semibold tabular-nums text-white bento:text-neutral-900">{w.battery ?? "–"}%{w.range ? <span className="ml-1 text-xs font-normal text-white/50">{Math.round(w.range)} mi</span> : null}</p>
          <p className="flex items-center gap-1 text-xs text-white/50 bento:text-neutral-500">
            {w.charging && !["Disconnected", "Stopped"].includes(w.charging) ? <><BatteryCharging className="h-3.5 w-3.5" aria-hidden />{w.charging}</> : w.locked === false ? <><LockOpen className="h-3.5 w-3.5 text-amber-300" aria-hidden />Unlocked</> : <><Lock className="h-3.5 w-3.5" aria-hidden />Locked</>}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/50 bento:text-neutral-500">{w.current ? "Out now" : "Car"}</p>
          <p className="truncate text-lg font-semibold text-white bento:text-neutral-900">{w.current ? w.current.guest ?? "Guest" : "Home"}</p>
          <p className="text-xs text-white/50 bento:text-neutral-500">{w.current ? `Back ${when(w.current.ends_at)}` : "No one has it"}</p>
        </div>
        <div>
          <p className="text-xs text-white/50 bento:text-neutral-500">{w.current ? "Return at" : "Next trip"}</p>
          {w.current
            ? <p className={cn("text-lg font-semibold tabular-nums", low ? "text-amber-300 bento:text-amber-700" : "text-white bento:text-neutral-900")}>{w.current.return_pct != null ? `${w.current.return_pct}%+` : "–"}</p>
            : <p className="truncate text-lg font-semibold text-white bento:text-neutral-900">{w.next?.guest ?? "None"}</p>}
          <p className="text-xs text-white/50 bento:text-neutral-500">{w.current ? (low ? "Below it now" : "Level at trip start") : w.next ? when(w.next.starts_at) : "Nothing booked"}</p>
        </div>
        <div>
          <p className="text-xs text-white/50 bento:text-neutral-500">Supercharging</p>
          <p className={cn("flex items-center gap-1 text-lg font-semibold tabular-nums", w.owed > 0 ? "text-red-300 bento:text-red-700" : "text-emerald-300 bento:text-emerald-700")}><Zap className="h-4 w-4" aria-hidden />{w.owed > 0 ? `$${w.owed.toFixed(2)}` : "All billed"}</p>
          <p className="text-xs text-white/50 bento:text-neutral-500">{w.owed > 0 ? "not requested in Turo" : `${w.alerts} car alert${w.alerts === 1 ? "" : "s"} today`}</p>
        </div>
      </div>
    </Link>
  );
}
