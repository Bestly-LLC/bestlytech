/**
 * /admin/emergency - one tap to start getting ready for a disaster.
 *
 * "Prep now" (here, or the red Emergency tile on the admin home) calls emergency_start():
 *   - the Home Hub agent on the Pi charges the EcoFlow DELTA 2 to 100% (homeassistant.ecoflow full:
 *     Jared's own storm automation + max charge level 100)
 *   - his phone gets a push
 *   - this checklist opens; ticks are saved in emergency_prep so they follow him to the phone
 * "All clear" ends it and puts the DELTA 2 back to its storage level.
 * The battery card asks the Pi for a fresh reading every two minutes while the page is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, BatteryCharging, Check, CloudRain, ExternalLink, Flame, Loader2, PlugZap, ShieldCheck, Siren, Waves, Zap,
} from "lucide-react";

type Hazard = "general" | "earthquake" | "fire" | "flood" | "outage";
type Prep = { id: string; hazard: Hazard; started_at: string; ended_at: string | null; checklist: Record<string, string>; charge_cmd: string | null };
type Battery = { battery: number | null; max_charge: number | null; input_watts: number | null; minutes_to_full: number | null; online: boolean;
  alerts: { Event?: string; Headline?: string; Severity?: string; Ends?: string; Expires?: string }[]; message?: string; at: string };

// Bound call: a bare reference to supabase.rpc loses `this` and throws "Cannot read properties of undefined (reading 'rest')".
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

const HAZARDS: { id: Hazard; label: string; icon: typeof Zap }[] = [
  { id: "general", label: "Anything", icon: Siren },
  { id: "earthquake", label: "Earthquake", icon: Waves },
  { id: "fire", label: "Fire / smoke", icon: Flame },
  { id: "flood", label: "Flood / storm", icon: CloudRain },
  { id: "outage", label: "Power out", icon: PlugZap },
];

type Item = { id: string; text: string; why?: string };
const FIRST: Item[] = [
  { id: "phones", text: "Charge your phone, laptop and power banks", why: "The wall may not be there later." },
  { id: "tesla", text: "Set the Tesla to charge to 100%", why: "It's a car and a very big battery." },
  { id: "water", text: "Fill water: jugs, and the bathtub", why: "A gallon per person per day, at least 3 days." },
  { id: "cash", text: "Get some cash", why: "Card readers go down with the power." },
  { id: "bag", text: "Go-bag by the door: meds, glasses, chargers, ID, keys", why: "Grab-and-go in one trip." },
  { id: "people", text: "Text Eli and family where you are and the plan", why: "Texts get through when calls don't." },
];
const BY_HAZARD: Record<Exclude<Hazard, "general">, Item[]> = {
  earthquake: [
    { id: "eq-shoes", text: "Shoes and a flashlight by the bed", why: "Broken glass is the #1 injury after a quake." },
    { id: "eq-gas", text: "Know where the gas shutoff is (wrench at the meter)", why: "Only shut it if you smell gas or hear a hiss." },
    { id: "eq-heavy", text: "Move heavy things off high shelves; stay away from windows" },
    { id: "eq-drop", text: "When it shakes: drop, cover, hold on" },
  ],
  fire: [
    { id: "fi-zone", text: "Check your evacuation zone (Genasys Protect) and Watch Duty" },
    { id: "fi-car", text: "Go-bag and documents in the car, car facing out" },
    { id: "fi-close", text: "Close every window and door; set the AC to recirculate" },
    { id: "fi-air", text: "Run the air purifier; N95 masks out" },
    { id: "fi-plan", text: "Pick where you'll go and two ways to get there" },
  ],
  flood: [
    { id: "fl-up", text: "Move electronics and papers off the floor" },
    { id: "fl-drains", text: "Clear the drains and gutters outside" },
    { id: "fl-bags", text: "Sandbags if water comes toward the door (LA County fire stations hand them out)" },
    { id: "fl-drive", text: "Never drive through moving water: turn around" },
  ],
  outage: [
    { id: "ou-fridge", text: "Keep the fridge and freezer shut", why: "4 hours for the fridge, 48 for a full freezer." },
    { id: "ou-delta", text: "Plug the router and modem into the DELTA 2", why: "Keeps Wi-Fi, the Pi and the cameras up." },
    { id: "ou-unplug", text: "Unplug computers and TVs for when it comes back" },
    { id: "ou-light", text: "Flashlights, not candles" },
  ],
};
const LINKS = [
  { label: "Alert LA County (sign up for alerts)", href: "https://ready.lacounty.gov/alert-la-county/" },
  { label: "Evacuation zones (Genasys Protect)", href: "https://protect.genasys.com/" },
  { label: "Watch Duty (fires near you)", href: "https://app.watchduty.org/" },
  { label: "Earthquakes right now (USGS)", href: "https://earthquake.usgs.gov/earthquakes/map/" },
  { label: "National Weather Service, Los Angeles", href: "https://www.weather.gov/lox/" },
];

async function awaitCommand(id: string, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const { data } = await db.from("home_hub_commands").select("status, result, error").eq("id", id).maybeSingle();
    if (data && ["done", "failed", "expired"].includes(data.status)) return data as { status: string; result: Battery | null; error: string | null };
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

/** Start prep from anywhere (the admin home tile uses this too). */
export async function startEmergency(hazard: Hazard = "general") {
  const { data, error } = await rpc("emergency_start", { p_hazard: hazard });
  if (error) throw new Error(error.message);
  return data as Prep;
}

export default function Emergency() {
  const { toast } = useToast();
  const nav = useNavigate();
  const [prep, setPrep] = useState<Prep | null | undefined>(undefined);
  const [hazard, setHazard] = useState<Hazard>("general");
  const [busy, setBusy] = useState(false);
  const [bat, setBat] = useState<Battery | null>(null);
  const [batErr, setBatErr] = useState<string | null>(null);
  const checking = useRef(false);

  const load = useCallback(async () => {
    const { data } = await db.from("emergency_prep").select("*").is("ended_at", null).maybeSingle();
    setPrep((data as Prep) ?? null);
    if (data) setHazard((data as Prep).hazard);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const { data: id, error } = await rpc("emergency_battery_check");
      if (error) throw new Error(error.message);
      const r = await awaitCommand(String(id));
      if (!r) setBatErr("The Pi didn't answer. Is the power (or internet) out at home?");
      else if (r.status !== "done") setBatErr(r.error ?? "Couldn't read the battery.");
      else { setBat({ ...(r.result as Battery), at: new Date().toISOString() }); setBatErr(null); }
    } catch (e) {
      setBatErr(e instanceof Error ? e.message : String(e));
    } finally {
      checking.current = false;
    }
  }, []);
  useEffect(() => {
    void check();
    const t = window.setInterval(() => void check(), 120_000);
    return () => window.clearInterval(t);
  }, [check]);

  // Right after "Prep now": show what the charge command reported.
  useEffect(() => {
    if (!prep?.charge_cmd) return;
    let live = true;
    void awaitCommand(prep.charge_cmd, 90_000).then((r) => {
      if (!live || !r) return;
      if (r.status === "done" && r.result) setBat({ ...r.result, at: new Date().toISOString() });
      else if (r.status !== "done") setBatErr(`Charging didn't start: ${r.error ?? r.status}`);
    });
    return () => { live = false; };
  }, [prep?.charge_cmd]);

  const start = async (h: Hazard = hazard) => {
    setBusy(true);
    try {
      const p = await startEmergency(h);
      setPrep(p);
      toast({ title: "Prep started", description: "Charging the DELTA 2 to 100%. Your phone got a heads-up." });
    } catch (e) {
      toast({ title: "Couldn't start", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const allClear = async () => {
    setBusy(true);
    const { error } = await rpc("emergency_end");
    setBusy(false);
    if (error) { toast({ title: "Couldn't end it", description: error.message, variant: "destructive" }); return; }
    setPrep(null);
    toast({ title: "All clear", description: "The DELTA 2 goes back to its storage level." });
  };

  const tick = async (id: string, done: boolean) => {
    if (!prep) return;
    setPrep({ ...prep, checklist: done ? { ...prep.checklist, [id]: new Date().toISOString() } : Object.fromEntries(Object.entries(prep.checklist).filter(([k]) => k !== id)) });
    const { error } = await rpc("emergency_tick", { p_item: id, p_done: done });
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); void load(); }
  };

  const items = useMemo(() => [...FIRST, ...(hazard === "general" ? [] : BY_HAZARD[hazard])], [hazard]);
  const doneCount = items.filter((i) => prep?.checklist?.[i.id]).length;
  const charging = bat && bat.max_charge != null && bat.max_charge >= 100;

  return (
    <div className="space-y-5">
      <PageHeader title="Emergency" description="One tap charges the EcoFlow to 100%, buzzes your phone and opens the checklist." />

      {/* the button */}
      <div className={cn("rounded-3xl p-5 sm:p-6", prep ? "bg-[#3a0d0d] ring-1 ring-red-500/40 bento:bg-[#fdecec]" : "bg-white/[0.03] ring-1 ring-white/10")}>
        <div className="flex flex-wrap gap-2">
          {HAZARDS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button"
              onClick={() => { setHazard(id); if (prep) void start(id); }}
              className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition",
                hazard === id ? "bg-[#ffffff] text-[#111114]" : "bg-white/[0.06] text-white/70 hover:bg-white/10")}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {prep ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-lg font-semibold text-[#ffffff]"><Siren className="h-5 w-5 text-red-400" /> Prep is on</p>
              <p className="text-sm text-white/60">Started {new Date(prep.started_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} · {doneCount} of {items.length} done</p>
            </div>
            <Button onClick={allClear} disabled={busy} variant="outline" className="border-white/20 bg-white/5 text-white">
              <ShieldCheck className="mr-2 h-4 w-4" /> All clear
            </Button>
          </div>
        ) : (
          <button type="button" onClick={() => void start()} disabled={busy || prep === undefined}
            className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-[#dc2626] px-6 py-5 text-xl font-bold text-[#ffffff] shadow-lg shadow-red-900/40 transition hover:bg-[#ef4444] active:scale-[0.99] disabled:opacity-60">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Siren className="h-6 w-6" />} Prep now
          </button>
        )}
      </div>

      {/* battery */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
          <p className="flex items-center gap-2 text-sm font-semibold text-white"><BatteryCharging className="h-4 w-4 text-white/50" /> EcoFlow DELTA 2</p>
          {bat ? (
            <>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-5xl font-bold tabular-nums text-white">{bat.battery ?? "–"}<span className="text-2xl text-white/50">%</span></span>
                {charging && <span className="mb-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">charging to 100%</span>}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-[#34c759] transition-[width]" style={{ width: `${Math.max(0, Math.min(100, bat.battery ?? 0))}%` }} />
              </div>
              <p className="mt-3 text-sm text-white/60">
                {!bat.online ? "Looks offline: check it's plugged in and on Wi-Fi." :
                  `Charge limit ${bat.max_charge ?? "?"}%` +
                  (bat.input_watts ? ` · ${Math.round(bat.input_watts)} W in` : " · not charging") +
                  (bat.minutes_to_full ? ` · full in ~${Math.round(bat.minutes_to_full)} min` : "")}
              </p>
              <p className="mt-1 text-xs text-white/35">Read {new Date(bat.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
            </>
          ) : batErr ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {batErr}</p>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Asking the Pi…</p>
          )}
          {bat?.alerts?.length ? (
            <div className="mt-4 space-y-2">
              {bat.alerts.map((a, i) => (
                <div key={i} className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-500/25">
                  <p className="font-semibold">{a.Event ?? "Weather alert"}</p>
                  {a.Headline && <p className="text-xs text-red-200/80">{a.Headline}</p>}
                </div>
              ))}
            </div>
          ) : bat ? <p className="mt-4 text-xs text-white/40">No National Weather Service alerts for home right now.</p> : null}
        </div>

        {/* checklist */}
        <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
          <p className="text-sm font-semibold text-white">{prep ? "Do these now" : "What Prep now will have you do"}</p>
          <ul className="mt-2">
            {items.map((it) => {
              const done = !!prep?.checklist?.[it.id];
              return (
                <li key={it.id} className="flex items-start gap-3 border-b border-white/[0.06] py-2.5 last:border-0">
                  <button type="button" disabled={!prep} aria-label={done ? "Mark not done" : "Mark done"} onClick={() => void tick(it.id, !done)}
                    className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition",
                      done ? "border-emerald-400 bg-emerald-400 text-[#111114]" : "border-white/25 text-transparent hover:border-emerald-400",
                      !prep && "opacity-40")}>
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0">
                    <p className={cn("text-[0.95rem] text-white", done && "text-white/40 line-through")}>{it.text}</p>
                    {it.why && <p className="text-xs text-white/45">{it.why}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
        <p className="text-sm font-semibold text-white">Where to look</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm text-white/75 hover:bg-white/[0.05] hover:text-white">
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/40" /> {l.label}
            </a>
          ))}
        </div>
        <button type="button" onClick={() => nav("/admin/home-hub/home-assistant")} className="mt-2 px-2 text-xs text-white/45 hover:text-white">
          The battery is run by Home Assistant on the Pi →
        </button>
      </div>
    </div>
  );
}
