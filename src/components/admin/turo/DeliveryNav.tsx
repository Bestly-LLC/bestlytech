/**
 * "Route to car" row for the Ready widget. Car Guard puts the next delivery (or the LAX garage) on the car's screen about 20 minutes
 * before Jared needs to leave, or sooner if he starts driving there. It stays quiet if he uses the car for something else first.
 * Data: delivery_nav_admin(); switch + options: delivery_nav_admin_set(); button: delivery_nav_send_now(). Commands go through TezLab only.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { focusRing, text, tint } from "@/components/admin/ui";
import { Lines } from "@/components/Lines";

type Decision = {
  state: string; reason?: string; place?: "delivery" | "lax" | "home" | null; label?: string | null; guest?: string | null;
  starts_at?: string | null; send_at?: string | null; leave_by?: string | null; sends_ok?: number; last_send_at?: string | null;
  last_send_label?: string | null; tezlab_up?: boolean;
};
type Nav = { enabled: boolean; lead_hours: number; max_sends: number; tezlab_up: boolean; last_tick_at: string | null; decision: Decision | null; problem: boolean };

const NB = " ";
const TZ = "America/Los_Angeles";
/** 12-hour clock in LA time. The space before AM/PM is a no-break space so "3:05 PM" never splits. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).replace(/\s/g, NB);
/** Today: "6:25 PM". Another day: "Wed 6:25 PM". */
function clockOrDay(iso: string) {
  const day = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric", timeZone: TZ });
  if (day(new Date(iso)) === day(new Date())) return clock(iso);
  return `${new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })}${NB}${clock(iso)}`;
}

function status(a: Nav): { line: string; sub?: string; warn?: boolean } {
  const d = a.decision;
  if (!a.enabled) return { line: "Off · nothing is sent to the car" };
  if (!d || d.state === "none") return { line: "No delivery or LAX trip coming up" };
  if (d.state === "home" || d.place === "home") return { line: "Next trip is a home pickup · nothing to send" };
  const where = d.label ?? "the address";
  const sent = (d.sends_ok ?? 0) > 0 && d.last_send_at;
  const sub = d.guest && d.starts_at ? `For ${d.guest}, starts ${clockOrDay(d.starts_at)}` : undefined;
  switch (d.state) {
    case "guest_active": return { line: "Waiting: car in use", sub };
    case "finding_address": return { line: "Finding the address", sub };
    case "address_error": return { line: "Couldn't find the address on the map · type it into the car", sub, warn: true };
    case "at_destination": return { line: `The car is already at ${where}`, sub };
    case "tezlab_down": return { line: "TezLab is down · tries again when it's back", sub, warn: true };
    case "gave_up": return { line: "Couldn't send after 3 tries · type it into the car", sub, warn: true };
    case "started": return { line: "That trip already started" };
    case "no_car": return { line: "Waiting for the car's location", sub };
    case "cap": return { line: `Sent ${d.last_send_at ? clockOrDay(d.last_send_at) : ""}: ${where} · send limit reached`, sub };
    default: break;
  }
  if (sent) return { line: `Sent ${clockOrDay(d.last_send_at!)}: ${d.last_send_label ?? where}${d.state === "in_use" ? " · car in use" : ""}`, sub };
  if (d.state === "in_use") return { line: "Waiting: car in use", sub };
  if (d.send_at) return { line: `Sends around ${clockOrDay(d.send_at)}`, sub };
  return { line: "Waiting for the right moment", sub };
}

function Stepper({ label, value, unit, min, max, disabled, onChange }: {
  label: string; value: number; unit: string; min: number; max: number; disabled: boolean; onChange: (v: number) => void;
}) {
  const btn = cn("grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white disabled:opacity-40", focusRing);
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <p className="text-[15px] text-white/80">{label}</p>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Less: ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)} className={btn}><Minus className="h-4 w-4" aria-hidden /></button>
        <span className="min-w-[96px] whitespace-nowrap text-center text-[15px] tabular-nums text-white">{value}{NB}{unit}</span>
        <button type="button" aria-label={`More: ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} className={btn}><Plus className="h-4 w-4" aria-hidden /></button>
      </div>
    </div>
  );
}

export function DeliveryNavRow() {
  const [a, setA] = useState<Nav | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await (supabase.rpc("delivery_nav_admin" as never) as unknown as Promise<{ data: Nav | null; error: unknown }>);
    if (!error && data) setA(data);
  }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => { if (!document.hidden) void load(); }, 60000); return () => window.clearInterval(id); }, [load]);

  const set = async (args: { p_enabled?: boolean; p_lead_hours?: number; p_max_sends?: number }, ok?: string) => {
    setBusy(true);
    const { data, error } = await (supabase.rpc("delivery_nav_admin_set" as never, args as never) as unknown as Promise<{ data: Nav | null; error: { message: string } | null }>);
    setBusy(false);
    if (error || !data) { toast.error(error?.message ?? "Couldn't change it"); return; }
    setA(data);
    if (ok) toast.success(ok);
  };
  const sendNow = async () => {
    setSending(true);
    const { data, error } = await (supabase.rpc("delivery_nav_send_now" as never) as unknown as Promise<{ data: { ok: boolean; message: string; admin: Nav } | null; error: { message: string } | null }>);
    setSending(false);
    if (error || !data) { toast.error(error?.message ?? "Couldn't send"); return; }
    if (data.admin) setA(data.admin);
    if (data.ok) toast.success(data.message); else toast.message(data.message);
  };

  if (!a) return null;
  const st = status(a);
  const canSend = !!a.decision && (a.decision.place === "delivery" || a.decision.place === "lax");
  return (
    <div className="border-t border-white/[0.06] px-4 py-3 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p id="delivery-nav-h" className="text-[15px] text-white">Route to car</p>
          <p className={cn(text.detail, "mt-0.5 break-words", st.warn && tint.orange)}><Lines>{st.line}</Lines></p>
          {st.sub && <p className={cn(text.detail, "break-words")}><Lines>{st.sub}</Lines></p>}
        </div>
        <Switch checked={a.enabled} disabled={busy} aria-labelledby="delivery-nav-h"
          onCheckedChange={(v) => void set({ p_enabled: v }, v ? "Route to car is on" : "Route to car is off")} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canSend && (
          <button type="button" onClick={() => void sendNow()} disabled={sending}
            className={cn("inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-[#0A84FF] px-3.5 text-[13px] font-semibold text-white disabled:opacity-50", focusRing)}>
            {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}Send now
          </button>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className={cn("min-h-[36px] rounded-md px-1 text-[13px] font-semibold text-[#0A84FF]", focusRing)}>{open ? "Hide options" : "Options"}</button>
      </div>
      {open && (
        <div className="mt-2 rounded-xl bg-white/[0.04] px-3.5 py-2 ring-1 ring-white/10">
          <Stepper label="Start checking" value={Number(a.lead_hours)} unit="hr before" min={1} max={12} disabled={busy}
            onChange={(v) => void set({ p_lead_hours: v })} />
          <Stepper label="Send up to" value={a.max_sends} unit={a.max_sends === 1 ? "time" : "times"} min={1} max={5} disabled={busy}
            onChange={(v) => void set({ p_max_sends: v })} />
          <p className={cn(text.detail, "pt-1")}><Lines>It sends about 20 minutes before you need to leave, or when the car starts driving there. It never sends while a guest has the car.</Lines></p>
        </div>
      )}
    </div>
  );
}
