import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Bound call: supabase.rpc unbound loses `this` ("reading 'rest'").
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";

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
  if (!st) return null;
  return (
    <div id="tesla" className={cn(card, "space-y-3")}>
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-4 w-4 text-violet-300 bento:text-violet-600" />
        <div>
          <p className="text-sm font-medium text-white bento:text-neutral-900">Tesla car controls</p>
          <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500">
            Free-only: stops at ${Number(st.monthly_cap_usd).toFixed(2)}/month (Tesla gives $10 free). This month: ${Number(st.spent_usd).toFixed(2)}.
          </p>
        </div>
      </div>
      {st.has_secret ? (
        st.connected ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm text-emerald-300 bento:text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Connected{st.vehicle_name ? `: ${st.vehicle_name}` : ""}{st.vin_last4 ? ` (VIN …${st.vin_last4})` : ""}</p>
            <p className="text-xs text-white/60 bento:text-neutral-600">If Tesla didn't ask you to add the key during sign-in: on your iPhone, near the car, open <a className="underline" href="https://tesla.com/_ak/www.bestly.tech">tesla.com/_ak/www.bestly.tech</a> and approve it in the Tesla app.</p>
            <p className="text-xs text-white/60 bento:text-neutral-600">
              Mac mini helper: {st.worker_online ? <b className="text-emerald-300 bento:text-emerald-700">online</b> : <b className="text-red-300 bento:text-red-700">offline</b>}
              {st.car?.observed_at ? ` · Car read ${new Date(st.car.observed_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}: ${st.car.battery ?? "?"}%, inside ${st.car.inside_f ?? "?"}°F${st.car.climate_on ? ", A/C on" : ""}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {([["cool", "Test: cool it down"], ["off", "Test: turn off"], ["refresh", "Read the car"]] as const).map(([a, label]) => (
                <button key={a} type="button" onClick={() => test(a)} disabled={testing !== null}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#111114] px-4 py-2 text-xs font-medium text-[#fff] ring-1 ring-[#ffffff26] disabled:opacity-60">
                  {testing === a && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-white bento:text-neutral-900">
              <input type="checkbox" checked={st.enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
              Show A/C buttons to guests (1 hour before pickup until return)
            </label>
            <button type="button" onClick={connect} disabled={connecting} className="text-xs text-white/60 underline bento:text-neutral-600">Reconnect</button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm text-emerald-300 bento:text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Client Secret is saved in Vault.</p>
            <button type="button" onClick={connect} disabled={connecting}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#e31937] px-5 py-2.5 text-sm font-medium text-[#fff] hover:bg-[#c8142f] disabled:opacity-60">
              {connecting && <Loader2 className="h-4 w-4 animate-spin" />} Connect your Tesla
            </button>
            <p className="text-xs text-white/60 bento:text-neutral-600">Sign in to Tesla, tap Allow, then add the Bestly key when it asks (do this on your iPhone near the car).</p>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)}
            placeholder="Paste the Tesla Client Secret"
            className="w-full rounded-lg border border-white/10 bg-transparent px-2.5 py-2 text-sm text-white bento:border-neutral-200 bento:text-neutral-900" />
          <button type="button" onClick={save} disabled={saving || secret.trim().length < 10}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save to Vault
          </button>
        </div>
      )}
      {st.last_error && <p className="text-xs text-red-300 bento:text-red-700">Last Tesla error: {st.last_error}</p>}
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
        <Wallet className="mt-0.5 h-4 w-4 text-teal-300 bento:text-teal-600" />
        <div>
          <p className="text-sm font-medium text-white bento:text-neutral-900">My host pass</p>
          <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500">Your own lobby door pass. Add it once on your iPhone. When you save the new code on the 1st, it updates itself.</p>
        </div>
      </div>
      <a href={url} className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#fff] px-5 py-2.5 text-sm font-medium text-[#111114] hover:bg-[#e8e8ec] bento:bg-[#111114] bento:text-[#fff] bento:hover:bg-[#2a2a30]">Add my pass to Apple Wallet</a>
    </div>
  );
}
