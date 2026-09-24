import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, KeyRound, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Switch, btnPlain, btnPrimary, btnTinted, card, field, label, pill, secondary, separator, tint } from "./laxUi";

// Bound call: supabase.rpc unbound loses `this` ("reading 'rest'").
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;


type Car = { observed_at: string | null; battery: number | null; inside_f: number | null; outside_f: number | null; climate_on: boolean | null; online: string | null };
type TState = { worker_online: boolean; worker_seen_at: string | null; car: Car | null; client_id: string | null; has_secret: boolean; connected: boolean; vehicle_name: string | null; vin_last4: string | null; last_error: string | null; enabled: boolean; monthly_cap_usd: number; per_trip_cap_usd: number; spent_usd: number };

/** Tesla Fleet API: paste the Client Secret once. It goes straight into Supabase Vault and can't be read back here. */
export function TeslaCard() {
  const [st, setSt] = useState<TState | null>(null);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await rpc("tesla_fleet_admin_state");
    if (!error) setSt(data as TState);
  }, []);
  useEffect(() => { load(); }, [load]);
  // Back from Tesla sign-in: /admin/turo/lax-pass?tesla=connected|error&why=…#tesla
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tesla");
    if (!t) return;
    if (t === "connected") toast.success(`Tesla connected${q.get("car") ? `: ${q.get("car")}` : ""}`);
    else toast.error("Tesla didn't connect", { description: q.get("why") ?? undefined });
    try { history.replaceState(null, "", window.location.pathname + "#tesla"); } catch { /* ignore */ }
  }, []);
  const [connecting, setConnecting] = useState(false);
  const connect = async () => {
    setConnecting(true);
    const { data, error } = await supabase.functions.invoke("tesla-fleet", { body: { op: "start" } });
    const url = (data as { url?: string } | null)?.url;
    if (error || !url) {
      setConnecting(false);
      toast.error("Couldn't start Tesla sign-in", { description: (data as { error?: string } | null)?.error ?? error?.message });
      load();
      return;
    }
    window.location.href = url;
  };
  // Admin test: queue a command, wait for the Mac mini helper to finish it.
  const [testing, setTesting] = useState<string | null>(null);
  const test = async (action: "cool" | "off" | "refresh") => {
    setTesting(action);
    try {
      const { data, error } = await rpc("tesla_admin_command", { p_action: action });
      if (error) throw new Error(error.message);
      const id = (data as { id: number }).id;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const { data: j } = await rpc("tesla_admin_job", { p_id: id });
        const job = j as { status: string; result?: { error?: string; msg?: string } } | null;
        if (job?.status === "done") { toast.success(job.result?.msg === "car is asleep" ? "Car is asleep (didn't wake it for a read)" : "Done"); load(); return; }
        if (job?.status === "failed") throw new Error(job.result?.error ?? "failed");
      }
      throw new Error("No answer after 2 minutes. Is the Mac mini helper running?");
    } catch (e) { toast.error("Tesla test failed", { description: (e as Error).message }); load(); }
    finally { setTesting(null); }
  };
  const setEnabled = async (on: boolean) => {
    const { error } = await rpc("tesla_admin_set_enabled", { p_on: on });
    if (error) toast.error(error.message); else { toast.success(on ? "Guest A/C buttons are on" : "Guest A/C buttons are off"); load(); }
  };
  const save = async () => {
    setSaving(true);
    const { error } = await rpc("tesla_fleet_set_secret", { p_secret: secret });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setSecret("");
    toast.success("Saved to Vault.");
    load();
  };
  if (!st) return <div className={cn(card, "h-40 animate-pulse")} aria-label="Loading" />;
  const carRead = st.car?.observed_at
    ? `${st.car.battery ?? "?"}% · inside ${st.car.inside_f ?? "?"}°F${st.car.climate_on ? " · A/C on" : ""} · read ${new Date(st.car.observed_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" })}`
    : "Not read yet";
  const rows: [string, ReactNode][] = [
    ["Car", st.connected ? `${st.vehicle_name ?? "Connected"}${st.vin_last4 ? ` · VIN …${st.vin_last4}` : ""}` : st.has_secret ? "Not connected yet" : "Needs the Client Secret"],
    ["Mac mini helper", <span key="w" className={st.worker_online ? tint.green : tint.red}>{st.worker_online ? "Online" : "Offline"}</span>],
    ["Last reading", carRead],
    ["Tesla spend", `$${Number(st.spent_usd).toFixed(2)} of $${Number(st.monthly_cap_usd).toFixed(2)} this month (free credit is $10)`],
  ];
  return (
    <div id="tesla" className="scroll-mt-24 space-y-3">
      <div className={cn(card, "p-0")}>
        <div className="flex items-center gap-3 px-5 pt-4">
          <KeyRound className={cn("h-5 w-5", tint.blue)} aria-hidden />
          <p className={cn("flex-1 text-[17px] font-semibold", label)}>Tesla</p>
          {st.connected && <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold", pill.green)}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Connected</span>}
        </div>
        <dl className={cn("mt-2 divide-y", separator)}>
          {rows.map(([k, v]) => (
            <div key={k} className="flex min-h-[44px] items-center justify-between gap-4 px-5 py-2.5">
              <dt className={cn("shrink-0 text-[15px]", secondary)}>{k}</dt>
              <dd className={cn("text-right text-[15px]", label)}>{v}</dd>
            </div>
          ))}
        </dl>
        {st.last_error && <p className={cn("px-5 pb-3 text-[13px]", tint.red)}>Last Tesla error: {st.last_error}</p>}
      </div>

      {st.connected ? (
        <>
          <div className={cn(card, "py-2")}>
            <Switch checked={st.enabled} onChange={setEnabled} label="A/C buttons on the guest page" detail="From 1 hour before pickup until return." />
          </div>
          <div className={cn(card, "space-y-3")}>
            <p className={cn("text-[15px] font-medium", label)}>Test the car</p>
            <div className="flex flex-wrap gap-2">
              {([["cool", "Cool it down"], ["off", "Turn A/C off"], ["refresh", "Read the car"]] as const).map(([a, t]) => (
                <button key={a} type="button" onClick={() => test(a)} disabled={testing !== null} className={cn(btnTinted, "px-4")}>
                  {testing === a && <Loader2 className="h-4 w-4 animate-spin" />}{t}
                </button>
              ))}
            </div>
            <p className={cn("text-[13px] leading-snug", secondary)}>
              If Tesla didn't ask you to add the key during sign-in: on your iPhone near the car, open{" "}
              <a className={cn("underline", tint.blue)} href="https://tesla.com/_ak/www.bestly.tech">tesla.com/_ak/www.bestly.tech</a> and approve it in the Tesla app.
            </p>
            <button type="button" onClick={connect} disabled={connecting} className={btnPlain}>
              {connecting && <Loader2 className="h-4 w-4 animate-spin" />} Reconnect Tesla
            </button>
          </div>
        </>
      ) : st.has_secret ? (
        <div className={cn(card, "space-y-3")}>
          <p className={cn("text-[15px]", secondary)}>Client Secret is saved in Vault. Sign in to Tesla, tap Allow, then add the Bestly key when it asks (on your iPhone, near the car).</p>
          <button type="button" onClick={connect} disabled={connecting} className={btnPrimary}>
            {connecting && <Loader2 className="h-4 w-4 animate-spin" />} Connect your Tesla
          </button>
        </div>
      ) : (
        <div className={cn(card, "space-y-3")}>
          <p className={cn("text-[15px] font-medium", label)}>Tesla Client Secret</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Paste the Tesla Client Secret" aria-label="Tesla Client Secret" className={field} />
            <button type="button" onClick={save} disabled={saving || secret.trim().length < 10} className={cn(btnPrimary, "shrink-0")}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save to Vault
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Jared's own Wallet pass: blue-hour art, no guest info, same lock-screen suggestions. Add once; it updates itself each month. */
export function HostPassCard() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { rpc("lax_pass_host_url").then(({ data }) => setUrl((data as string) ?? null)); }, []);
  if (!url) return null;
  return (
    <div className={cn(card, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
      <div className="flex items-start gap-3">
        <Wallet className={cn("mt-0.5 h-5 w-5", tint.blue)} aria-hidden />
        <div>
          <p className="text-[17px] font-semibold text-white bento:text-neutral-900">My host pass</p>
          <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>Your own lobby door pass. Add it once on your iPhone. When you save the new code on the 1st, it updates itself.</p>
        </div>
      </div>
      <a href={url} className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full bg-[#fff] px-5 text-[15px] font-semibold text-[#000] hover:bg-[#e8e8ec] active:scale-[0.97] bento:bg-[#000] bento:text-[#fff] bento:hover:bg-[#2a2a30] sm:min-h-[36px]">Add my pass to Apple Wallet</a>
    </div>
  );
}
