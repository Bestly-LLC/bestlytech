/**
 * Plug Puller (Charging Attendant) card on /admin/turo#plug-puller.
 * The Pi job (/opt/bestly/cron/jobs/charge_stop.py, every minute) ends Jared's ChargePoint session when the Tesla is done:
 * the car's own charge limit, or the one-off target picked here. Login = ChargePoint email + coulomb_sess cookie,
 * saved write-only into Vault (chargepoint_connect). Migration 20261006080000_plug_puller.sql.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { btnPrimary, btnTinted, card, field, label, pill, secondary, Segmented, Switch, tint } from "./laxUi";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const nw = "whitespace-nowrap";

type Status = {
  enabled: boolean; target_override: number | null; signed_in: boolean | null; last_error: string | null; last_cp_check_at: string | null;
  session_id: number | null; station: string | null; session_state: string | null; power_kw: number | null; energy_kwh: number | null; cost: number | null;
  battery: number | null; car_limit: number | null; stop_tries: number; last_stopped_at: string | null; last_stopped_summary: string | null;
  connected: boolean; log: { at: string; kind: string; detail: Record<string, unknown> }[];
};
const KIND: Record<string, string> = {
  watching: "Started watching", stopped: "Ended the session", stop_failed: "Stop didn't confirm", ended: "Session ended",
  signed_out: "ChargePoint signed me out", signed_in: "Signed back in", connected: "Login saved", target: "Target changed",
};

export function PlugPuller() {
  const [s, setS] = useState<Status | null>(null);
  const [email, setEmail] = useState("");
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [relogin, setRelogin] = useState(false);
  const load = useCallback(async () => { const { data, error } = await rpc("charge_stop_status"); if (error) toast.error(error.message); else setS(data as Status); }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 30000); return () => window.clearInterval(id); }, [load]);

  const connect = async () => {
    setBusy(true);
    const { error } = await rpc("chargepoint_connect", { p_username: email, p_token: cookie });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setCookie(""); setRelogin(false); toast.success("Saved. Plug Puller checks in within a minute."); void load();
  };
  const set = async (args: Record<string, unknown>) => {
    const { data, error } = await rpc("charge_stop_set", args);
    if (error) toast.error(error.message); else setS(data as Status);
  };

  if (!s) return <div className={card} id="plug-puller"><Loader2 className="h-5 w-5 animate-spin text-white/60" /></div>;
  const needLogin = !s.connected || s.signed_in === false || relogin;
  const target = s.target_override ?? s.car_limit;
  const status = !s.connected ? { t: "Not connected", c: pill.orange } : s.signed_in === false ? { t: "Signed out", c: pill.orange }
    : !s.enabled ? { t: "Paused", c: pill.orange } : s.session_id ? { t: "Watching a charge", c: pill.blue } : { t: "On duty", c: pill.green };
  const opts = ["car", "60", "70", "80", "90"] as const;
  const seg = (s.target_override == null ? "car" : String(s.target_override)) as (typeof opts)[number];

  return (
    <div className={card} id="plug-puller">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[17px] font-semibold", label)}>Plug Puller · ChargePoint</p>
          <p className={cn("mt-0.5 text-xs", secondary)}>Ends your ChargePoint session the minute the Tesla is done, so the idle fee never starts.</p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", nw, status.c)}>
          <PlugZap className="h-3.5 w-3.5" aria-hidden />{status.t}
        </span>
      </div>

      {needLogin ? (
        <div className="mt-4 space-y-3">
          {s.signed_in === false && s.connected && !relogin && (
            <p className={cn("flex items-start gap-1.5 text-[13px]", tint.orange)}><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />ChargePoint signed Plug Puller out. Paste a fresh cookie below.</p>
          )}
          <ol className={cn("list-decimal space-y-1 pl-5 text-[13px] leading-snug", secondary)}>
            <li>Open <a href="https://driver.chargepoint.com" target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1", tint.blue)}>driver.chargepoint.com<ExternalLink className="h-3 w-3" /></a> in Chrome and log in.</li>
            <li>Right-click the page, Inspect, then Application, Cookies, driver.chargepoint.com.</li>
            <li>Copy the value of <span className={cn("font-mono", label)}>coulomb_sess</span> and paste it below.</li>
          </ol>
          <input className={field} type="email" autoComplete="username" placeholder="Your ChargePoint email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={field} type="password" autoComplete="off" placeholder="coulomb_sess cookie" value={cookie} onChange={(e) => setCookie(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy || !email || cookie.length < 20} onClick={() => void connect()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save to Vault</button>
            {relogin && <button type="button" className={btnTinted} onClick={() => setRelogin(false)}>Cancel</button>}
          </div>
          <p className={cn("text-xs", secondary)}>Saved write-only in Supabase Vault. It never shows here again.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {s.session_id ? (
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Tile k="Car" v={s.battery != null ? `${s.battery}%` : "?"} sub={target ? `stop at ${target}%` : "stop when done"} />
              <Tile k="Power" v={s.power_kw != null ? `${Number(s.power_kw).toFixed(1)} kW` : "?"} sub={s.session_state ?? ""} />
              <Tile k="Added" v={s.energy_kwh != null ? `${Number(s.energy_kwh).toFixed(1)} kWh` : "?"} sub={s.cost != null ? `$${Number(s.cost).toFixed(2)} so far` : ""} />
              <Tile wrap k="Station" v={s.station ?? "ChargePoint"} sub={s.stop_tries ? `stop tries: ${s.stop_tries}` : ""} />
            </div>
          ) : (
            <p className={cn("text-[13px]", secondary)}>No ChargePoint session right now. Plug in and it starts watching within 2 minutes.</p>
          )}
          <div>
            <p className={cn("mb-1.5 text-[13px] font-medium", label)}>End the session at</p>
            <Segmented ariaLabel="Charge target" value={seg} onChange={(v) => void set(v === "car" ? { p_clear_target: true } : { p_target: Number(v) })}
              options={opts.map((o) => ({ value: o, label: o === "car" ? `Car limit${s.car_limit ? ` (${s.car_limit}%)` : ""}` : `${o}%` }))} />
            <p className={cn("mt-1.5 text-xs", secondary)}>Car limit = whatever you set in the Tesla app. A % here is one-off: it resets after this charge.</p>
          </div>
          <Switch checked={s.enabled} onChange={(v) => void set({ p_enabled: v })} label="Plug Puller on duty" detail="Off = it won't touch your sessions." />
          {s.last_stopped_summary && s.last_stopped_at && (
            <p className={cn("flex items-start gap-1.5 text-[13px]", tint.green)}><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{when(s.last_stopped_at)}: {s.last_stopped_summary}</p>
          )}
          {s.log.length > 0 && (
            <ul className={cn("space-y-0.5 text-xs", secondary)}>
              {s.log.slice(0, 5).map((l, i) => <li key={i}><span className={nw}>{when(l.at)}</span> · {KIND[l.kind] ?? l.kind}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cn("text-xs", secondary)}>{s.last_cp_check_at ? `Last checked ChargePoint ${when(s.last_cp_check_at)}` : "Waiting for the first check"}</p>
            <button type="button" className={cn(btnTinted, "shrink-0 whitespace-nowrap px-4")} onClick={() => setRelogin(true)}>Update login</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ k, v, sub, wrap }: { k: string; v: string; sub?: string; wrap?: boolean }) {
  return (
    <div className="rounded-[14px] bg-[#2C2C2E] p-3 bento:bg-[#7676801f]">
      <p className={cn("text-[11px] uppercase tracking-wide", secondary)}>{k}</p>
      <p className={cn("mt-0.5 text-[15px] font-semibold tabular-nums", wrap ? "break-words" : nw, label)}>{v}</p>
      {sub && <p className={cn("mt-0.5 text-[11px]", secondary)}>{sub}</p>}
    </div>
  );
}
