/**
 * Projector health for /admin/wall. Data comes from the Pi watchdog (status.health, every minute).
 * The Capsule 3 reports battery %, charge rate, battery + CPU temperature, thermal state, Wi-Fi and memory.
 * It does NOT report fan speed, so the fan animation follows the heat level (labelled as an estimate).
 */
import { motion, useReducedMotion } from "framer-motion";
import { BatteryCharging, BatteryFull, Fan, ShieldCheck, ShieldAlert, Thermometer, Wifi, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export type Health = {
  at?: number; pct?: number | null; charging?: boolean; plugged?: boolean | null; watts?: number | null;
  batt_c?: number | null; batt_v?: number | null; cpu_c?: number | null; thermal?: number | null;
  uptime_s?: number | null; mem_used_pct?: number | null; wifi_dbm?: number | null; fps?: number | null;
  battery_health?: string | null; hist?: [number, number | null, number | null, number | null][];
  care?: { state: "ok" | "warm" | "cooling" | "attention"; note: string; warm_c: number; hot_c: number };
};

const toF = (c: number) => Math.round((c * 9) / 5 + 32);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const upText = (s?: number | null) => {
  if (s == null) return "–";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

function Tile({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-h-[148px] flex-col rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10", className)}>{children}</div>;
}
function Label({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-white/50">
      <Icon className="h-3.5 w-3.5" aria-hidden /> {children}
    </div>
  );
}

function BatteryRing({ h }: { h: Health }) {
  const pct = clamp(h.pct ?? 0, 0, 100), r = 36, c = 2 * Math.PI * r;
  const col = pct <= 20 ? "#FF453A" : pct <= 50 ? "#FFD60A" : "#30D158";
  return (
    <Tile>
      <Label icon={h.charging ? BatteryCharging : BatteryFull}>Battery</Label>
      <div className="mt-2 flex items-center gap-4">
        <div className="relative h-[88px] w-[88px] shrink-0">
          <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
            <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="8" />
            <motion.circle cx="44" cy="44" r={r} fill="none" stroke={col} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct / 100) }}
              transition={{ type: "spring", stiffness: 60, damping: 18 }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[22px] font-semibold tabular-nums text-white">{h.pct ?? "–"}%</div>
        </div>
        <div className="min-w-0 space-y-1 text-[14px]">
          {h.charging ? (
            <div className="flex items-center gap-1 text-[#30D158]">
              <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.6, repeat: Infinity }}><Zap className="h-4 w-4" aria-hidden /></motion.span>
              Charging{h.watts ? ` · ${h.watts} W` : ""}
            </div>
          ) : (
            <div className="text-white/70">{h.plugged ? "Plugged in" : "On battery"}</div>
          )}
          <div className="text-white/55">{h.batt_c != null ? `${toF(h.batt_c)}°F` : "–"}{h.batt_v ? ` · ${h.batt_v} V` : ""}</div>
          <div className="text-white/55">Health: {h.battery_health ?? "–"}</div>
        </div>
      </div>
    </Tile>
  );
}

function HeatGauge({ h }: { h: Health }) {
  const cpu = h.cpu_c ?? null, f = cpu == null ? 0 : clamp((cpu - 40) / (95 - 40), 0, 1);
  const word = cpu == null ? "–" : cpu >= 85 ? "Hot" : cpu >= 75 ? "Warm" : "Normal";
  return (
    <Tile>
      <Label icon={Thermometer}>Heat</Label>
      <div className="mt-2 flex flex-1 items-end gap-4">
        <div className="relative h-[92px] w-5 overflow-hidden rounded-full bg-white/10">
          <motion.div className="absolute bottom-0 left-0 right-0 rounded-full"
            style={{ background: "linear-gradient(to top,#64D2FF,#FFD60A 55%,#FF9F0A 75%,#FF453A)" , backgroundSize: "100% 92px", backgroundPosition: "bottom" }}
            initial={{ height: 0 }} animate={{ height: `${f * 100}%` }} transition={{ type: "spring", stiffness: 50, damping: 16 }} />
        </div>
        <div>
          <div className="text-[28px] font-semibold tabular-nums text-white">{cpu != null ? `${toF(cpu)}°` : "–"}</div>
          <div className="text-[14px] text-white/60">Chip · {word}</div>
          <div className="text-[13px] text-white/45">Shuts off at {toF(85)}°F</div>
        </div>
      </div>
    </Tile>
  );
}

function FanTile({ h }: { h: Health }) {
  const reduce = useReducedMotion();
  const cpu = h.cpu_c ?? 55, load = clamp((cpu - 50) / (92 - 50), 0, 1);
  const secs = 3.2 - load * 2.8, word = load > 0.75 ? "Working hard" : load > 0.4 ? "Working" : "Calm";
  return (
    <Tile>
      <Label icon={Fan}>Cooling</Label>
      <div className="mt-2 flex flex-1 items-center gap-4">
        <motion.div className="text-sky-300" animate={reduce ? undefined : { rotate: 360 }}
          transition={{ duration: secs, repeat: Infinity, ease: "linear" }} key={secs.toFixed(1)}>
          <Fan className="h-[72px] w-[72px]" strokeWidth={1.6} aria-hidden />
        </motion.div>
        <div>
          <div className="text-[20px] font-semibold text-white">{word}</div>
          <div className="text-[13px] leading-snug text-white/45">Estimated from heat. This projector doesn't report fan speed.</div>
        </div>
      </div>
    </Tile>
  );
}

function LinkTile({ h }: { h: Health }) {
  const dbm = h.wifi_dbm ?? null, bars = dbm == null ? 0 : dbm > -55 ? 4 : dbm > -65 ? 3 : dbm > -75 ? 2 : 1;
  const word = ["No signal", "Weak", "Fair", "Good", "Strong"][bars];
  return (
    <Tile>
      <Label icon={Wifi}>System</Label>
      <div className="mt-2 flex items-end gap-1" aria-label={`Wi-Fi ${word}`}>
        {[1, 2, 3, 4].map((b) => (
          <motion.span key={b} className={cn("w-2.5 rounded-sm", b <= bars ? "bg-white" : "bg-white/15")}
            initial={{ height: 4 }} animate={{ height: 6 + b * 7 }} transition={{ delay: b * 0.08, type: "spring", stiffness: 200, damping: 16 }} />
        ))}
        <span className="ml-2 text-[15px] text-white">{word}</span>
        {dbm != null && <span className="ml-1 text-[13px] text-white/45">{dbm} dBm</span>}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
        <div><dt className="text-white/45">Up</dt><dd className="font-medium tabular-nums text-white">{upText(h.uptime_s)}</dd></div>
        <div><dt className="text-white/45">Memory</dt><dd className="font-medium tabular-nums text-white">{h.mem_used_pct ?? "–"}%</dd></div>
        <div><dt className="text-white/45">Smooth</dt><dd className="font-medium tabular-nums text-white">{h.fps ?? "–"} fps</dd></div>
      </dl>
    </Tile>
  );
}

function History({ h }: { h: Health }) {
  const pts = (h.hist ?? []).filter((p) => p[1] != null);
  if (pts.length < 3) return null;
  const W = 320, H = 70, t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const X = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const line = (i: 1 | 3, lo: number, hi: number) =>
    pts.filter((p) => p[i] != null).map((p, k) => `${k ? "L" : "M"}${X(p[0]).toFixed(1)} ${(H - clamp(((p[i] as number) - lo) / (hi - lo), 0, 1) * H).toFixed(1)}`).join(" ");
  return (
    <div className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
      <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.06em] text-white/50">
        <span>Last {Math.max(1, Math.round((t1 - t0) / 60))} min</span>
        <span className="flex gap-3 normal-case tracking-normal"><span className="text-[#30D158]">● Battery</span><span className="text-[#FF9F0A]">● Heat</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[70px] w-full" preserveAspectRatio="none">
        <motion.path d={line(1, 0, 100)} fill="none" stroke="#30D158" strokeWidth="2.2" vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: "easeOut" }} />
        <motion.path d={line(3, 40, 95)} fill="none" stroke="#FF9F0A" strokeWidth="2.2" vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, delay: 0.2, ease: "easeOut" }} />
      </svg>
    </div>
  );
}

export function ProjectorHealth({ health }: { health?: Health | null }) {
  if (!health) return null;
  const care = health.care;
  const good = !care || care.state === "ok";
  return (
    <section className="space-y-2" aria-label="Projector health">
      <h2 className="px-4 text-[13px] font-medium uppercase tracking-[0.06em] text-white/50">Projector health</h2>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BatteryRing h={health} />
        <HeatGauge h={health} />
        <FanTile h={health} />
        <LinkTile h={health} />
      </motion.div>
      <History h={health} />
      {care && (
        <div className={cn("flex items-start gap-3 rounded-2xl p-4 ring-1", good ? "bg-emerald-500/[0.07] ring-emerald-400/25" : "bg-amber-500/10 ring-amber-400/30")}>
          {good ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden /> : <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />}
          <div className="text-[14px] leading-snug">
            <div className="font-semibold text-white">Battery Care · {care.note}</div>
            <div className="mt-0.5 text-white/55">
              This projector can't cap charging at 80%, so Battery Care guards against heat instead. It alerts Scout above {toF(care.warm_c)}°F
              and puts the projector to sleep above {toF(care.hot_c)}°F until it cools.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
