/**
 * "Ready for next guest": an iOS-style widget for Turo Watch and the Command Center.
 * One answer on top (Ready for Willie / Almost ready · 1 thing / On GianPaula's trip), then the checks
 * (charge, tires, locked + windows, software, last guest's data wiped, where it's parked), each with a one-tap fix
 * when there is one. Data: admin_car_ready(); fixes: admin_car_fix() (TezLab only, never the paid Tesla API).
 * While a guest is heading back it also shows the host-only arrival estimate ("about 12 min away").
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Car, Check, ChevronRight, Loader2, Navigation } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { LoadError, SectionHeader, cardCls, focusRing, text, tint } from "@/components/admin/ui";

type CheckRow = { id: string; label: string; state: "ok" | "warn" | "unknown"; value: string; action?: string | null; hint?: string | null };
type Ready = {
  next: { guest: string | null; starts_at: string; kind: string } | null;
  on_trip: { guest: string | null; ends_at: string } | null;
  eta: { minutes: number; miles: number; eta_at: string; moving: boolean } | null;
  checks: CheckRow[]; state: "ready" | "warn" | "partial"; checked_at: string | null; warn_count: number;
};
const ACTION_LABEL: Record<string, string> = { lock: "Lock", windows_close: "Close windows", charge_start: "Start charging", erase: "Wipe now" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
function until(iso: string) {
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (m < 60) return `${Math.max(m, 0)} min`;
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d >= 1 ? `${d} day${d === 1 ? "" : "s"} ${h % 24} hr` : `${h} hr ${m % 60} min`;
}

function Dot({ s }: { s: CheckRow["state"] }) {
  if (s === "ok") return <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-[#30D158] text-black" aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>;
  if (s === "warn") return <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-[#FF9F0A] text-[13px] font-bold text-black" aria-hidden>!</span>;
  return <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-white/15 text-[13px] font-bold text-white/70" aria-hidden>?</span>;
}

export function ReadyWidget({ compact = false }: { compact?: boolean }) {
  const [r, setR] = useState<Ready | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await (supabase.rpc("admin_car_ready" as never) as unknown as Promise<{ data: Ready | null; error: unknown }>);
    if (error || !data) { setFailed(true); return; }
    setFailed(false); setR(data);
  }, []);
  useEffect(() => { load(); const id = window.setInterval(() => { if (!document.hidden) load(); }, 60000); return () => window.clearInterval(id); }, [load]);

  const fix = async (action: string) => {
    if (action === "erase" && !window.confirm("Wipe guest data from the car? This clears saved places, the driver profile and paired phones. First time: check afterwards that your own settings are still there.")) return;
    setBusy(action);
    const { data, error } = await (supabase.rpc("admin_car_fix" as never, { p_action: action } as never) as unknown as Promise<{ data: { ok: boolean; error?: string } | null; error: { message: string } | null }>);
    setBusy(null);
    if (error || !data?.ok) { toast.error(data?.error ?? error?.message ?? "Couldn't send it"); return; }
    toast.success("Sent to the car. It updates here in about a minute.");
    window.setTimeout(load, 45000);
  };

  const header = <SectionHeader id="ready-title" title={r?.on_trip ? "Car" : "Next guest"} icon={<Car className="h-3.5 w-3.5" aria-hidden />}
    aside={r?.next ? `${r.next.guest ?? "Guest"} · ${when(r.next.starts_at)}` : undefined} />;
  if (!r) return (
    <section aria-labelledby="ready-title">
      {header}
      {failed ? <div className={cn(cardCls, "p-4 sm:p-6")}><LoadError label="the car check" onRetry={load} /></div>
        : <div className={cn(cardCls, "h-[164px] animate-pulse")} aria-label="Loading the car check" />}
    </section>
  );

  const warns = r.checks.filter((c) => c.state === "warn");
  const ready = r.state === "ready";
  const title = r.on_trip
    ? `On ${r.on_trip.guest ?? "a guest"}'s trip`
    : ready ? `Ready for ${r.next?.guest ?? "the next guest"}`
    : warns.length ? `Almost ready · ${warns.length} thing${warns.length === 1 ? "" : "s"}` : "Mostly ready";
  const sub = r.on_trip
    ? `Back ${when(r.on_trip.ends_at)}`
    : r.next ? `Pickup in ${until(r.next.starts_at)}${r.checked_at ? ` · checked ${clock(r.checked_at)}` : ""}` : "No trip booked";
  const rows = compact && ready ? [] : compact ? warns : r.checks;

  return (
    <section aria-labelledby="ready-title">
      {header}
      <div className={cn(cardCls, "overflow-hidden")}>
        <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[12px]", ready || r.on_trip ? "bg-[#30D15826] text-[#30D158]" : "bg-[#FF9F0A26] text-[#FF9F0A]")} aria-hidden>
            {r.on_trip ? <Car className="h-6 w-6" /> : ready ? <Check className="h-6 w-6" strokeWidth={2.6} /> : <AlertTriangle className="h-6 w-6" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold leading-tight text-white">{title}</p>
            <p className={cn(text.detail, "mt-0.5 truncate")}>{sub}</p>
          </div>
          {compact && <Link to="/admin/turo#ready" aria-label="Open the car check" className={cn("grid h-11 w-11 place-items-center rounded-full text-white/50 hover:text-white/80", focusRing)}><ChevronRight className="h-5 w-5" /></Link>}
        </div>
        {r.eta && (
          <div className="flex items-center gap-3 border-t border-white/[0.06] px-4 py-3 sm:px-5">
            <Navigation className={cn("h-5 w-5 shrink-0", tint.blue)} aria-hidden />
            <p className="min-w-0 flex-1 text-[15px] text-white"><b className="font-semibold">{r.on_trip?.guest ?? "Guest"} is about {r.eta.minutes} min away</b>
              <span className="text-white/60"> · {r.eta.miles} mi{r.eta.moving ? "" : " · parked"}</span></p>
          </div>
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {rows.map((c) => (
              <li key={c.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2 sm:px-5">
                <Dot s={c.state} />
                <span className="text-[15px] text-white">{c.label}</span>
                <span className={cn("min-w-0 flex-1 truncate text-right text-[15px]", c.state === "warn" ? tint.orange : "text-white/60")} title={c.value}>{c.value}{c.hint ? ` · ${c.hint}` : ""}</span>
                {c.action && ACTION_LABEL[c.action] && (
                  <button type="button" onClick={() => fix(c.action!)} disabled={!!busy}
                    className={cn("inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-[#0A84FF] px-3.5 text-[13px] font-semibold text-white disabled:opacity-50", focusRing)}>
                    {busy === c.action && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}{ACTION_LABEL[c.action]}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!compact && !r.on_trip && r.next && (
          <p className={cn(text.detail, "border-t border-white/[0.06] px-4 py-3 sm:px-5")}>Scout pings you if anything is still orange 1 hour before pickup.</p>
        )}
      </div>
    </section>
  );
}
