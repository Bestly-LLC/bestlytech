/**
 * Charging card on the Turo settings page (Jared 2026-10-06).
 *
 * The charger in his building bills time-of-use energy plus $3.00/hour once the car has been done charging
 * for 30 minutes. That idle fee cost about $15 between May and October without ever being visible. Charge
 * Watch (car_charge_tick, every 2 min) now keeps its own session and the Live Activity counts down to it.
 *
 * This card is where the two things that drive it are set, so neither has to be typed into Supabase by hand:
 *   - the ChargePoint login, which goes straight into Vault through home_hub_vault_put. That function is
 *     write-only: what you type here is never read back to a browser, and only its "last saved" time returns.
 *   - the rate card, read off a real ChargePoint receipt. Change it here when Essex changes it, never in code.
 */
import { useCallback, useEffect, useState } from "react";
import { BatteryCharging, Check, CircleAlert, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Section, btnPrimary, btnTinted, card, field, label, pill, secondary, separator, tertiary, tint } from "./laxUi";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

interface Settings {
  night_rate: number; day_rate: number; night_from_hour: number; night_to_hour: number;
  session_fee: number; idle_grace_min: number; idle_rate_hr: number; station: string;
}
interface Live { open: boolean; started_at: string; ended_at: string | null; at_home: boolean; dc_fast: boolean; kwh: number; cost: number; idle_fee: number; start_pct: number | null; end_pct: number | null; stopped_at: string | null }
interface Admin {
  settings: Settings;
  chargepoint: { email_at: string | null; token_at: string | null; ready: boolean;
                 signed_in: boolean | null; last_error: string | null; last_check_at: string | null;
                 last_stopped_at: string | null; last_stopped_summary: string | null };
  now: Live | null;
  recent: { started_at: string; ended_at: string; kwh: number; cost: number; idle_fee: number; at_home: boolean }[];
}

const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const hour12 = (h: number) => (h === 0 ? "12 AM" : h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`);

export function ChargingCard() {
  const [a, setA] = useState<Admin | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [rates, setRates] = useState<{ night: string; day: string; fee: string; grace: string; idle: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await rpc("home_charge_admin");
    if (error) { toast.error("Couldn't read the charging settings."); return; }
    const d = data as Admin;
    setA(d);
    setRates({
      night: String(d.settings.night_rate), day: String(d.settings.day_rate),
      fee: String(d.settings.session_fee), grace: String(d.settings.idle_grace_min), idle: String(d.settings.idle_rate_hr),
    });
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveLogin = async () => {
    if (!email.trim() && !token.trim()) { toast.error("Add the email or paste a token."); return; }
    setBusy(true);
    // chargepoint_connect writes pi:chargepoint:username / :token -- the same store the Plug Puller job on
    // the Pi reads. Write-only: the page can save a credential, never read one back.
    const { error } = await rpc("chargepoint_connect", {
      p_username: email.trim() || null,
      p_token: token.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message || "Couldn't save the login."); return; }
    setEmail(""); setToken("");
    toast.success("Saved. The Plug Puller picks it up on its next run.");
    await load();
  };

  const saveRates = async () => {
    if (!rates) return;
    setBusy(true);
    const { error } = await rpc("home_charge_admin_set", {
      p_night: Number(rates.night), p_day: Number(rates.day), p_session_fee: Number(rates.fee),
      p_idle_grace: Number(rates.grace), p_idle_rate: Number(rates.idle),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Rate card updated.");
    await load();
  };

  if (!a || !rates) {
    return (
      <Section title="Charging">
        <div className={cn(card, "flex h-32 items-center justify-center")}>
          <Loader2 className={cn("h-6 w-6 animate-spin", tertiary)} aria-label="Loading" />
        </div>
      </Section>
    );
  }

  const live = a.now;
  const open = !!live?.open;
  // An open session somewhere else (a Supercharger) isn't this charger's: these rates and the idle fee
  // don't apply, so the card says so rather than showing a $0.00 charge that reads as free electricity.
  const away = open && !live!.at_home;
  const idling = open && !away && !!live!.stopped_at;

  return (
    <Section
      title="Charging"
      id="charging"
      footer={<>Charge Watch reads the car every 2&nbsp;minutes and keeps its own running kWh, because Tesla never reports one. It counts down to the idle fee and tells you before the meter starts. Rates come from a real ChargePoint receipt &mdash; change them here when {a.settings.station} changes them.</>}
    >
      {/* What is happening right now */}
      <div className={cn(card, "space-y-3")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn("text-[13px]", secondary)}>{a.settings.station}</p>
            <p className={cn("mt-0.5 text-[17px] font-semibold", label)}>
              {!open
                ? "Nothing on the plug"
                : away
                  ? `Plugged in elsewhere${live!.dc_fast ? ", fast charging" : ""}`
                  : idling
                    ? "Done charging, still plugged in"
                    : "Charging now"}
            </p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold",
            !open ? pill.blue : away ? pill.blue : idling ? pill.orange : pill.green)}>
            {!open ? "Idle" : away ? "Away" : idling ? "Watch it" : "Live"}
          </span>
        </div>
        {open && away && (
          <p className={cn("border-t border-[#38383A] pt-3 text-[13px] leading-snug bento:border-[#C6C6C8]", secondary)}>
            {live!.kwh.toFixed(2)} kWh so far. These rates and the idle fee are {a.settings.station} only, so
            nothing here is priced.
          </p>
        )}
        {open && !away && (
          <dl className="grid grid-cols-3 gap-3 border-t border-[#38383A] pt-3 bento:border-[#C6C6C8]">
            {[
              ["Energy", `${live!.kwh.toFixed(2)} kWh`],
              ["Cost so far", money(live!.cost)],
              ["Idle fee", live!.idle_fee > 0 ? money(live!.idle_fee) : "None"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className={cn("text-[12px]", secondary)}>{k}</dt>
                <dd className={cn("mt-0.5 text-[15px] font-semibold tabular-nums", k === "Idle fee" && live!.idle_fee > 0 ? tint.orange : label)}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* ChargePoint login -> Vault */}
      <div className={cn(card, "space-y-3")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn("text-[15px] font-semibold", label)}>ChargePoint login</p>
            <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
              So Charge Watch can end the session before the idle fee starts. Stored in Vault, write-only &mdash;
              nothing typed here can be read back, by this page or anyone.
            </p>
          </div>
          {a.chargepoint.signed_in === false ? (
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold", pill.orange)}>
              <CircleAlert className="h-3.5 w-3.5" aria-hidden /> Needs a new token
            </span>
          ) : a.chargepoint.ready ? (
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold", pill.green)}>
              <Check className="h-3.5 w-3.5" aria-hidden /> {a.chargepoint.signed_in ? "Signed in" : "Saved"}
            </span>
          ) : (
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold", pill.orange)}>
              <CircleAlert className="h-3.5 w-3.5" aria-hidden /> Needed
            </span>
          )}
        </div>

        <div className="grid gap-3">
          <label className="block">
            <span className={cn("mb-1 block text-[13px]", secondary)}>Email</span>
            <input type="email" autoComplete="off" className={field} value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={a.chargepoint.email_at ? "Saved · type to replace" : "you@example.com"} />
          </label>
        </div>

        {/* The token is the part that actually works: ChargePoint blocks password logins from servers. */}
        <label className="block">
          <span className={cn("mb-1 block text-[13px]", secondary)}>
            Session token <span className={tertiary}>&middot; this is the one that works</span>
          </span>
          <input type="password" autoComplete="off" className={field} value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={a.chargepoint.token_at ? "Saved \u00b7 paste a new one to replace" : "paste coulomb_sess here"} />
          <span className={cn("mt-1.5 block text-[12px] leading-snug", tertiary)}>
            ChargePoint refuses password logins from servers, so the Plug Puller signs in with a session
            token instead. Open <strong>na.chargepoint.com</strong> while signed in &mdash; the cookie is not on
            the driver portal &mdash; then Inspect &rarr; Application &rarr; Cookies &rarr; na.chargepoint.com and
            copy <strong>coulomb_sess</strong>. It is HttpOnly, which is why only you can copy it. The job
            refreshes it on its own after this; you only come back here if it ever truly expires.
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={cn("inline-flex items-center gap-1.5 text-[12px]", tertiary)}>
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {a.chargepoint.signed_in === true && a.chargepoint.last_check_at
              ? `Signed in, checked ${when(a.chargepoint.last_check_at)}`
              : a.chargepoint.signed_in === false
                ? a.chargepoint.last_error || "Sign-in is failing"
                : a.chargepoint.token_at
                  ? `Token saved ${when(a.chargepoint.token_at)}`
                  : "Nothing saved yet"}
          </p>
          <button type="button" className={btnPrimary} onClick={saveLogin} disabled={busy || (!email.trim() && !token.trim())}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BatteryCharging className="h-4 w-4" aria-hidden />}
            Save to Vault
          </button>
        </div>
      </div>

      {/* The rate card */}
      <div className={cn(card, "space-y-3")}>
        <div>
          <p className={cn("text-[15px] font-semibold", label)}>What it costs</p>
          <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
            Night is {hour12(a.settings.night_from_hour)} to {hour12(a.settings.night_to_hour)}; the rest of the day uses the day rate.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["night", "Night, per kWh", rates.night],
            ["day", "Day, per kWh", rates.day],
            ["fee", "Per session", rates.fee],
            ["idle", "Idle, per hour", rates.idle],
            ["grace", "Grace, minutes", rates.grace],
          ] as const).map(([key, text, val]) => (
            <label key={key} className="block">
              <span className={cn("mb-1 block text-[13px]", secondary)}>{text}</span>
              <input inputMode="decimal" className={field} value={val}
                onChange={(e) => setRates({ ...rates, [key]: e.target.value })} />
            </label>
          ))}
        </div>
        <button type="button" className={btnTinted} onClick={saveRates} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save rates
        </button>
      </div>

      {/* Recent sessions, so an idle fee is never invisible again */}
      {a.recent.length > 0 && (
        <ul className={cn(card, "divide-y p-0", separator)}>
          {a.recent.map((r) => (
            <li key={r.started_at} className="flex min-h-[44px] items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className={cn("text-[15px]", label)}>{when(r.started_at)}</p>
                <p className={cn("text-[13px]", secondary)}>
                  {r.kwh.toFixed(2)} kWh{r.idle_fee > 0 ? ` · ${money(r.idle_fee)} idle` : ""}
                </p>
              </div>
              <span className={cn("shrink-0 text-[15px] font-semibold tabular-nums", r.idle_fee > 0 ? tint.orange : label)}>
                {money(r.cost)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
