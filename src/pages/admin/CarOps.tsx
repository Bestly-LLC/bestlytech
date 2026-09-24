/**
 * Car money + health cards on /admin/turo/lax-pass.
 *  - SuperchargeAudit: every Tesla Supercharging session (Tesla billing, backfilled from May 2026, refreshed daily)
 *    matched to Turo trips (synced trips + Turo booking emails), against Turo reimbursement emails (requested / paid).
 *    Shows what was never billed. Scout alerts once per trip (supercharge_audit_tick, 10:37 AM daily).
 *  - CarHealth: live car status, tires + software (one Tesla read per 12 h), TezLab battery health, and the alert log
 *    from car_watch_tick (every 5 min: guest charge-done / low battery / unlocked / trunk, your ChargePoint idle alerts).
 */
import { useCallback, useEffect, useState } from "react";
import { BatteryCharging, CheckCircle2, CircleAlert, ExternalLink, Gauge, Loader2, Lock, LockOpen, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";
import { card, secondary, label, tint } from "./laxUi";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const money = (n?: number | null) => `$${(n ?? 0).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const small = "inline-flex h-8 items-center gap-1.5 rounded-full border border-white/15 px-3 text-[12px] font-medium text-white disabled:opacity-50 bento:border-neutral-200 bento:text-neutral-800";

type Sess = { at: string; place: string | null; cost: number; idle: number; kwh: number | null };
type Trip = { rid: number; guest: string | null; starts_at: string; ends_at: string; billed: number; idle: number; count: number; asked: number; paid: boolean; status: string; owed: number; sessions: Sess[] };
type Audit = { owed: number; waiting: number; collected: number; billed: number; yours: number; yours_count: number; sessions: number; since: string | null; synced_at: string | null; trips: Trip[] };

const STATUS: Record<string, { text: string; cls: string }> = {
  not_billed: { text: "Not requested", cls: tint.red }, short: { text: "Requested too little", cls: tint.orange },
  waiting: { text: "Waiting on guest", cls: tint.orange }, paid: { text: "Paid", cls: tint.green },
  on_trip: { text: "On trip now", cls: tint.blue }, settled: { text: "Marked settled", cls: tint.green }, none: { text: "No Supercharging", cls: "" },
};

export function SuperchargeAudit() {
  const [a, setA] = useState<Audit | null>(null);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(async () => { const { data, error } = await rpc("supercharge_audit"); if (error) toast.error(error.message); else setA(data as Audit); }, []);
  useEffect(() => { void load(); }, [load]);
  const settle = async (rid: number, on: boolean) => { const { data, error } = await rpc("supercharge_audit_settle", { p_rid: rid, p_on: on }); if (error) toast.error(error.message); else setA(data as Audit); };
  if (!a) return <div className={card}><Loader2 className="h-5 w-5 animate-spin text-white/50" /></div>;
  const trips = a.trips.filter((t) => t.status !== "none");
  const todo = trips.filter((t) => t.status === "not_billed" || t.status === "short");
  const list = showAll ? trips : todo;
  return (
    <div className={card} id="sc-audit">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn("text-[17px] font-semibold", label)}>Supercharging audit</p>
          <p className={cn("mt-0.5 text-xs", secondary)}>Tesla's billed Supercharging vs. what you asked guests for in Turo.</p>
        </div>
        <Zap className={cn("h-5 w-5 shrink-0", a.owed > 0 ? tint.red : tint.green)} />
      </div>
      <p className={cn("mt-3 text-[30px] font-bold leading-none tabular-nums", a.owed > 0 ? tint.red : tint.green)}>{a.owed > 0 ? money(a.owed) : "All billed"}</p>
      <p className={cn("mt-1 text-[13px]", secondary)}>{a.owed > 0 ? `not requested yet · ${todo.length} trip${todo.length === 1 ? "" : "s"}` : "Every guest Supercharge has been requested."}
        {` · collected ${money(a.collected)}`}{a.waiting > 0 ? ` · waiting ${money(a.waiting)}` : ""}</p>

      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-white/[0.06] bento:divide-neutral-100">
          {list.map((t) => {
            const st = STATUS[t.status] ?? STATUS.none;
            const copy = [`Supercharging during ${t.guest ?? "the"} trip: ${money(t.billed)} (${t.count} session${t.count === 1 ? "" : "s"}${t.idle > 0 ? `, incl. ${money(t.idle)} idle fees` : ""}).`,
              ...t.sessions.map((s) => `- ${when(s.at)} ${s.place ?? "Supercharger"}: ${money(s.cost + s.idle)}${s.kwh ? ` (${s.kwh} kWh)` : ""}`),
              "Amounts are from Tesla's Supercharger billing (invoices available)."].join("\n");
            const need = t.status === "not_billed" || t.status === "short";
            return (
              <li key={t.rid} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className={cn("text-[15px] font-medium", label)}>{t.guest ?? "Guest"} <span className={cn("text-xs font-normal", secondary)}>{day(t.starts_at)}–{day(t.ends_at)}</span></p>
                  <p className="text-[15px] font-semibold tabular-nums">{money(t.billed)}</p>
                </div>
                <p className={cn("mt-0.5 flex items-center gap-1.5 text-xs", st.cls || secondary)}>
                  {need ? <CircleAlert className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {st.text}{t.status === "short" ? `: asked ${money(t.asked)}, ${money(t.owed)} short` : t.asked > 0 && t.status !== "not_billed" ? ` · asked ${money(t.asked)}` : ""} · {t.count} stop{t.count === 1 ? "" : "s"}
                </p>
                {need && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <CopyButton text={copy} label="Copy for Turo" />
                    <a href={`https://turo.com/us/en/reservation/${t.rid}`} target="_blank" rel="noopener noreferrer" className={small}><ExternalLink className="h-3.5 w-3.5" />Open trip in Turo</a>
                    <button type="button" className={small} onClick={() => void settle(t.rid, true)}>Mark settled</button>
                  </div>
                )}
                {t.status === "settled" && <button type="button" className={cn(small, "mt-2")} onClick={() => void settle(t.rid, false)}>Undo settled</button>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={small} onClick={() => setShowAll((x) => !x)}>{showAll ? "Only what's owed" : `All trips (${trips.length})`}</button>
        <button type="button" className={small} onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
      </div>
      <p className={cn("mt-3 text-xs leading-relaxed", secondary)}>
        Your own Supercharging (no trip): {money(a.yours)} over {a.yours_count} stops{a.since ? ` since ${day(a.since)}` : ""}. Trips come from Turo's booking emails, so trips before mid-August aren't matched.
        Reads Tesla billing daily; requests and payments come from Turo's emails. {a.synced_at ? `Last sync ${when(a.synced_at)}.` : ""}
      </p>
    </div>
  );
}

type Health = {
  name: string | null; observed_at: string | null; battery: number | null; range: number | null; charging: string | null; plugged_in: boolean | null;
  locked: boolean | null; online: string | null; software: string | null; odometer: number | null;
  health: { tires?: Record<string, number | null>; tire_warn?: Record<string, boolean>; update?: { status: string | null; version: string | null } } | null; health_at: string | null;
  last_tick_at: string | null; log: { at: string; kind: string; audience: string; title: string; body: string }[];
};
const FN = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/tezlab";

export function CarHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bh, setBh] = useState<Record<string, unknown> | null>(null);
  const load = useCallback(async () => { const { data, error } = await rpc("car_health_admin"); if (error) toast.error(error.message); else setH(data as Health); }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 60000); return () => window.clearInterval(id); }, [load]);
  const check = async () => { setBusy("check"); const { error } = await rpc("car_health_check_now"); if (error) toast.error(error.message); else { toast.success("Asking the car. Updates in about a minute."); window.setTimeout(() => { void load(); setBusy(null); }, 40000); return; } setBusy(null); };
  const battery = async () => {
    setBusy("bh");
    const { data: s } = await supabase.auth.getSession();
    const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` }, body: JSON.stringify({ op: "battery_health" }) }).then((x) => x.json()).catch(() => null);
    setBusy(null);
    if (r?.ok) setBh(r.health as Record<string, unknown>); else toast.error(r?.error ?? "TezLab didn't answer");
  };
  if (!h) return <div className={card}><Loader2 className="h-5 w-5 animate-spin text-white/50" /></div>;
  const tires = h.health?.tires ?? null;
  const low = tires ? Math.min(...Object.values(tires).filter((x): x is number => typeof x === "number")) : null;
  const upd = h.health?.update?.status;
  const pick = (o: Record<string, unknown> | null, ...k: string[]) => { for (const x of k) { const v = o?.[x]; if (v != null && typeof v !== "object") return String(v); } return null; };
  return (
    <div className={card} id="car-health">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn("text-[17px] font-semibold", label)}>Car health · {h.name ?? "Tesla"}</p>
          <p className={cn("mt-0.5 text-xs", secondary)}>Watched every 5 minutes. Problems go to Scout; guests get a push for charging, low battery, unlocked, trunk open.</p>
        </div>
        <button type="button" onClick={() => void check()} disabled={!!busy} className={small}>{busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Check now</button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Tile icon={<BatteryCharging className="h-4 w-4" />} k="Battery" v={h.battery != null ? `${h.battery}%${h.range ? ` · ${Math.round(h.range)} mi` : ""}` : "?"} sub={h.charging && h.charging !== "Disconnected" ? h.charging : h.plugged_in ? "Plugged in" : "Not plugged in"} />
        <Tile icon={h.locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />} k="Doors" v={h.locked == null ? "?" : h.locked ? "Locked" : "Unlocked"} bad={h.locked === false} sub={h.online ?? ""} />
        <Tile icon={<Gauge className="h-4 w-4" />} k="Tires (psi)" v={tires ? `${tires.fl ?? "?"} ${tires.fr ?? "?"} / ${tires.rl ?? "?"} ${tires.rr ?? "?"}` : "Not read yet"} bad={low != null && low < 37} sub={h.health_at ? `Read ${when(h.health_at)}` : "Reads when the car is awake"} />
        <Tile icon={<ShieldCheck className="h-4 w-4" />} k="Software" v={h.software ?? "?"} bad={!!upd && upd !== "" } sub={upd ? `Update ${upd}` : "Up to date"} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void battery()} disabled={!!busy} className={small}>{busy === "bh" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BatteryCharging className="h-3.5 w-3.5" />}Battery health (TezLab)</button>
        {bh && <span className={cn("text-xs", secondary)}>
          {[pick(bh, "health_score", "score") && `Health: ${pick(bh, "health_score", "score")}`, pick(bh, "degradation_pct") && `${pick(bh, "degradation_pct")}% degraded`,
            pick(bh, "current_capacity_kwh") && `${pick(bh, "current_capacity_kwh")} kWh`, pick(bh, "cycle_count", "cycles") && `${pick(bh, "cycle_count", "cycles")} cycles`].filter(Boolean).join(" · ") || "Loaded."}
        </span>}
      </div>
      <p className={cn("mt-4 text-[13px] font-semibold", label)}>Recent alerts</p>
      {h.log.length === 0 ? <p className={cn("mt-1 text-xs", secondary)}>Nothing yet.</p> : (
        <ul className="mt-1 divide-y divide-white/[0.06] bento:divide-neutral-100">
          {h.log.slice(0, 8).map((x) => (
            <li key={x.at + x.kind} className="py-2 text-xs">
              <span className={cn("font-medium", label)}>{x.title}</span> <span className={secondary}>· {x.audience === "guest" ? "sent to guest" : "to you"} · {when(x.at)}</span>
              <p className={secondary}>{x.body}</p>
            </li>
          ))}
        </ul>
      )}
      <p className={cn("mt-3 text-xs leading-relaxed", secondary)}>
        ChargePoint at home: when {h.name ?? "the car"} finishes charging you get a push right away and again after 20 minutes, before ChargePoint's $3/hr idle fee.
        {h.last_tick_at ? ` Last check ${when(h.last_tick_at)}.` : ""}
      </p>
    </div>
  );
}

function Tile({ icon, k, v, sub, bad }: { icon: React.ReactNode; k: string; v: string; sub?: string; bad?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-3 bento:bg-neutral-50">
      <p className={cn("flex items-center gap-1.5 text-[11px] uppercase tracking-wide", secondary)}>{icon}{k}</p>
      <p className={cn("mt-1 text-[15px] font-semibold tabular-nums", bad ? tint.orange : label)}>{v}</p>
      {sub && <p className={cn("text-[11px]", secondary)}>{sub}</p>}
    </div>
  );
}
