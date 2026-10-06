/**
 * Host-only strip at the top of a trip page (Jared 2026-10-05). Shows ONLY on a device that holds the host pass
 * (the same ?dk=… pass the demo page uses; the Live Activity tap link carries it). Everyone else, the guest included,
 * gets nothing: host_trip_panel answers null without a valid pass.
 *
 * What it says: where the car is going (an estimate from which way it is moving), battery now against pickup
 * (flagged when MORE than 10 points under), Supercharger stops and cost, and a Complete trip button that ends the
 * Home Assistant Live Activity. Once the guest is confirmed driving it greys out the pickup / check-in steps.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { demoPass } from "./demo";

const rpc = supabase.rpc.bind(supabase) as unknown as (f: string, a?: object) => Promise<{ data: unknown }>;
const NB = " ";

type Phase = {
  phase: "away" | "heading_home" | "home" | "home_low";
  pickup: number | null; battery: number | null; short: boolean; delta: number | null;
  eta_min: number | null; eta_at: string | null; dist_mi: number | null;
  sc_stops: number; sc_cost: number;
};
type Panel = { ok: boolean; guest: string | null; ends_at: string; drove: string | null; completed: string | null; phase: Phase | null };

const t12 = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const money = (n: number) => `$${n.toFixed(2)}`;

const STYLE = `html.host-driving .host-grey{opacity:.38;filter:grayscale(.7);pointer-events:none;user-select:none;transition:opacity .25s}`;

export function HostPanel({ token }: { token?: string }) {
  const [p, setP] = useState<Panel | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const pass = demoPass();
    if (!token || !pass) { setP(null); return; }
    const { data } = await rpc("host_trip_panel", { p_pass: pass, p_token: token }).catch(() => ({ data: null }));
    setP((data as Panel | null)?.ok ? (data as Panel) : null);
  }, [token]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    const vis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [load]);

  // Guest confirmed driving: grey out the check-in steps below (they carry the host-grey class).
  const driving = !!p?.drove && !p?.completed;
  useEffect(() => {
    document.documentElement.classList.toggle("host-driving", driving);
    return () => document.documentElement.classList.remove("host-driving");
  }, [driving]);

  useEffect(() => { if (!armed) return; const id = window.setTimeout(() => setArmed(false), 4000); return () => window.clearTimeout(id); }, [armed]);

  if (!p) return null;
  const ph = p.phase;
  const guest = p.guest || "Guest";

  const complete = async () => {
    if (!armed) { setArmed(true); return; }
    setBusy(true); setErr(null);
    const { data } = await rpc("host_trip_complete", { p_pass: demoPass(), p_token: token }).catch(() => ({ data: null }));
    setBusy(false); setArmed(false);
    if ((data as { ok?: boolean } | null)?.ok) void load(); else setErr("Could not complete the trip. Try again.");
  };

  let where = "Away from home";
  let detail = ph?.dist_mi != null ? `${ph.dist_mi}${NB}mi from home` : "";
  if (ph?.phase === "heading_home") {
    where = "Heading home (estimate)";
    detail = ph.eta_min != null && ph.eta_at ? `About ${ph.eta_min}${NB}min, around ${t12(ph.eta_at)}` : detail;
  } else if (ph?.phase === "home") { where = "Home"; detail = ""; }
  else if (ph?.phase === "home_low") { where = "Home, battery under pickup"; detail = ""; }

  return (
    <section aria-label="Host view" className="mb-5 rounded-3xl bg-black/35 p-4 ring-1 ring-white/15">
      <style>{STYLE}</style>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Host view · {guest}</p>

      {p.completed ? (
        <p className="mt-3 flex items-center gap-2 text-[16px] font-semibold text-white"><CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden /> Trip completed. The Live Activity is gone.</p>
      ) : (
        <>
          <p className="mt-2 text-[20px] font-bold leading-tight text-white">{where}</p>
          {detail && <p className="mt-0.5 text-[15px] text-white/80">{detail}</p>}

          {ph && ph.battery != null && ph.pickup != null && (
            <div className={`mt-3 rounded-2xl p-3 ring-1 ${ph.short ? "bg-[#FF9F0A]/15 ring-[#FF9F0A]/50" : "bg-white/[0.06] ring-white/10"}`}>
              <p className="text-[15px] font-semibold text-white">{ph.battery}%{NB}now · {ph.pickup}%{NB}at pickup</p>
              {ph.short
                ? <p className="mt-1 flex items-start gap-1.5 text-[14px] leading-snug text-[#FFD08A]"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {Math.abs(ph.delta ?? 0)}{NB}points under pickup, more than the 10{NB}point limit.</p>
                : <p className="mt-1 text-[14px] text-white/70">{(ph.delta ?? 0) >= 0 ? "At or above" : `${Math.abs(ph.delta ?? 0)}${NB}points under`} the pickup level. Within the 10{NB}point limit.</p>}
            </div>
          )}

          <p className="mt-3 text-[15px] text-white/85">
            {ph && ph.sc_stops > 0 ? `Superchargers: ${ph.sc_stops}${NB}${ph.sc_stops === 1 ? "stop" : "stops"}, ${money(ph.sc_cost)}` : "No Superchargers on this trip yet."}
          </p>

          {p.drove && <p className="mt-2 text-[13px] text-white/60">Guest confirmed driving, so the pickup steps below are greyed out.</p>}

          <button type="button" onClick={complete} disabled={busy}
            className={`mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold active:scale-[0.99] ${armed ? "bg-emerald-400 text-[#0B2B1B]" : "bg-white text-[#1A1140]"}`}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-5 w-5" aria-hidden />}
            {armed ? "Tap again to complete" : "Complete trip"}
          </button>
          {err && <p role="alert" className="mt-2 text-[13px] text-[#FFB4A8]">{err}</p>}
        </>
      )}
    </section>
  );
}
