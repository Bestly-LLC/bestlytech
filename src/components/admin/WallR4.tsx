/**
 * Wall admin sections added in round 4 (W4): Do Not Disturb, Motivate me, Packages.
 *
 * Do Not Disturb = wall_state.state.dnd {on, from:"HH:MM", to:"HH:MM", override:{mode:"on"|"off", until:ms}|null}.
 * The same rules run in wall.html dndNow(), server.py dnd_now(), watchdog dnd_eval() and SQL wall_dnd_eval():
 * an unexpired override wins, then "on" + the from/to window in Los Angeles time. It silences wall sounds, the
 * hourly chime, pop-ups and spoken announcements; alarms and heads-ups Jared set himself still ring.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Check, ChevronDown, Moon, Package, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import { Group, Row, NW, btn, swHit } from "@/components/admin/wallUi";

export type Dnd = { on: boolean; from: string; to: string; override: { mode: "on" | "off"; until: number } | null };
export const DND_DEFAULT: Dnd = { on: true, from: "22:30", to: "07:00", override: null };

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

/** Minutes past midnight in Los Angeles right now. */
function laMinutes(at = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  return (Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24) * 60 + Number(p.find((x) => x.type === "minute")?.value ?? 0);
}
const hm = (s: string | undefined, dflt: number) => {
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(s ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : dflt;
};
/** "22:30" -> "10:30 PM". */
export const label12 = (s: string) => {
  const t = hm(s, 0), h = Math.floor(t / 60), m = t % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
/** The next moment (ms) the Los Angeles clock reads hh:mm. */
export function nextAt(s: string, now = Date.now()) {
  const cur = laMinutes(new Date(now));
  let diff = (hm(s, 0) - cur + 1440) % 1440;
  if (diff === 0) diff = 1440;
  return now - (now % 60000) + diff * 60000;
}
const time12 = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", " ");

/** Effective Do Not Disturb now. Same rules as the wall, the Pi and SQL wall_dnd_eval. */
export function dndEval(d: Dnd | null | undefined, now = Date.now()) {
  const x = d ?? DND_DEFAULT;
  const o = x.override;
  if (o && (o.mode === "on" || o.mode === "off") && o.until > now) return { on: o.mode === "on", why: "override" as const, until: o.until };
  if (x.on === false) return { on: false, why: "off" as const, until: null };
  const f = hm(x.from, 1350), t = hm(x.to, 420), cur = laMinutes(new Date(now));
  const on = f === t ? false : f < t ? cur >= f && cur < t : cur >= f || cur < t;
  // when does the current state flip next (schedule only)?
  const until = f === t ? null : nextAt(on ? x.to : x.from, now);
  return { on, why: "schedule" as const, until };
}

/** Every 15 minutes, labeled in 12-hour time. */
const TIMES = Array.from({ length: 96 }, (_, i) => {
  const v = `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;
  return { v, l: label12(v) };
});

function TimeSelect({ id, value, onChange, label, disabled }: { id: string; value: string; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  const opts = TIMES.some((t) => t.v === value) ? TIMES : [{ v: value, l: label12(value) }, ...TIMES];
  return (
    <select id={id} aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      className="min-h-[44px] min-w-[128px] rounded-lg bg-white/[0.08] px-3 text-[16px] tabular-nums text-white ring-1 ring-white/15 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-40 [color-scheme:dark]">
      {opts.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
    </select>
  );
}

type DndQuick = { id: string; label: React.ReactNode; p: Partial<Dnd>; msg: string; icon: React.ElementType };

/** Status line and the quick overrides that fit right now. Shared by the full card and the compact Now version.
 *  Quick ids match the manifest (src/config/wall-controls.json) control ids without the "dnd_" prefix. */
function dndModel(dnd: Dnd | null | undefined, now = Date.now()) {
  const d: Dnd = { ...DND_DEFAULT, ...(dnd ?? {}) };
  const ev = dndEval(d, now);
  const ovr = ev.why === "override";
  const status = ev.on
    ? (ev.until ? <>Quiet until <NW>{time12(ev.until)}</NW></> : "Quiet")
    : ev.why === "off" ? "Off. Sounds and pop-ups any time."
    : ev.until ? <>Sounds on. Quiet starts at <NW>{time12(ev.until)}</NW></> : "Sounds on";
  const hour = now + 3600_000;
  const morning = nextAt(d.to, now);
  const night = nextAt(d.from, now);
  const quick: DndQuick[] = ev.on
    ? [{ id: "allow_hour", label: <>Allow sounds for 1{" "}hour</>, p: { override: { mode: "off" as const, until: hour } }, msg: `Sounds allowed until ${time12(hour)}.`, icon: Volume2 },
]
    : [{ id: "quiet_hour", label: <>Quiet for 1{" "}hour</>, p: { override: { mode: "on" as const, until: hour } }, msg: `Quiet until ${time12(hour)}.`, icon: Moon },
       { id: "quiet_morning", label: <>Quiet until <NW>{label12(d.to)}</NW></>, p: { override: { mode: "on" as const, until: morning } }, msg: `Quiet until ${time12(morning)}.`, icon: Moon }];
  if (ev.on && d.on && !ovr) {
    quick.push({ id: "allow_morning", label: <>Allow sounds until <NW>{label12(d.to)}</NW></>, p: { override: { mode: "off" as const, until: morning } }, msg: `Sounds allowed until ${time12(morning)}.`, icon: Volume2 });
  }
  if (!ev.on && d.on && !ovr && night - now < 6 * 3600_000) {
    quick.push({ id: "allow_tonight", label: <>Allow sounds past <NW>{label12(d.from)}</NW></>, p: { override: { mode: "off" as const, until: nextAt(d.to, night) } }, msg: `Sounds allowed tonight, until ${time12(nextAt(d.to, night))}.`, icon: Volume2 });
  }
  return { d, ev, ovr, status, quick };
}

/** Do Not Disturb card: status line, schedule switch, from/to, and quick overrides.
 *  `compact` (the Now area) keeps only the status line, Schedule and the quick buttons listed in `only`. */
export function DndCard({ dnd, onChange, compact, only }: {
  dnd: Dnd | null | undefined; onChange: (d: Dnd, msg: string) => void;
  compact?: boolean; only?: string[];
}) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 20000); return () => clearInterval(t); }, []);
  const { d, ev, ovr, status, quick: all } = dndModel(dnd, Date.now());
  const quick = only ? all.filter((q) => only.includes(`dnd_${q.id}`)) : all;
  const set = (p: Partial<Dnd>, msg: string) => onChange({ ...d, ...p }, msg);
  return (
    <Group id={compact ? undefined : "dnd"} title="Do Not Disturb"
      footer={compact ? undefined : "Quiets wall sounds, the hourly chime, pop-ups and spoken announcements. Alarms and heads-ups you set still ring."}>
      <div className={cn("flex items-center gap-3 border-b border-white/[0.07] px-4 py-3", compact && quick.length === 0 && "border-b-0")}>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", ev.on ? "bg-indigo-500 text-white" : "bg-white/[0.08] text-white/60")} aria-hidden>
          <Moon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          <div className="text-[17px] font-semibold leading-snug text-white">{status}</div>
          <div className="text-[13px] text-white/50">
            {ovr ? "You changed it for now. The schedule takes over after." : d.on ? <>Every night <NW>{label12(d.from)}</NW> to <NW>{label12(d.to)}</NW></> : "Schedule is off"}
          </div>
        </div>
        {ovr && (
          <button type="button" className={cn(btn, "shrink-0 px-3 text-[14px]")} aria-label="Back on the schedule" onClick={() => set({ override: null }, "Back on the schedule.")}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Schedule
          </button>
        )}
      </div>
      {!compact && <>
      <Row label="Scheduled" detail="Quiet every night between these times." htmlFor="wall-dnd-on">
        <Switch className={swHit} id="wall-dnd-on" checked={d.on !== false}
          onCheckedChange={(v) => set({ on: v, override: null }, v ? `Do Not Disturb on, ${label12(d.from)} to ${label12(d.to)}.` : "Do Not Disturb off. Sounds any time.")} />
      </Row>
      <div className={cn("grid grid-cols-2 gap-3 border-b border-white/[0.07] px-4 py-3", d.on === false && "opacity-50")}>
        <label htmlFor="wall-dnd-from" className="space-y-1">
          <span className="block text-[13px] text-white/55">From</span>
          <TimeSelect id="wall-dnd-from" label="Quiet from" value={d.from} disabled={d.on === false}
            onChange={(v) => set({ from: v }, `Quiet from ${label12(v)}.`)} />
        </label>
        <label htmlFor="wall-dnd-to" className="space-y-1">
          <span className="block text-[13px] text-white/55">To</span>
          <TimeSelect id="wall-dnd-to" label="Quiet until" value={d.to} disabled={d.on === false}
            onChange={(v) => set({ to: v }, `Quiet until ${label12(v)}.`)} />
        </label>
      </div>
      </>}
      {quick.length > 0 && (
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-2" role="group" aria-label="Quick changes">
          {quick.map((q) => (
            <button key={q.id} type="button" className={cn(btn, "justify-start px-3 text-[15px]")} onClick={() => set(q.p, q.msg)}>
              <q.icon className="h-4 w-4 shrink-0 text-white/70" aria-hidden /> <span className="min-w-0 text-left">{q.label}</span>
            </button>
          ))}
        </div>
      )}
    </Group>
  );
}

/** "Motivate me": bumps motivate.seq; the wall plays the pep-talk show once per new seq (W5).
 *  `tile` draws it as a square tile for the Moments row in the Now area. */
export function MotivateButton({ seq, onFire, tile }: { seq: number; onFire: (next: { seq: number; ts: number }) => void; tile?: boolean }) {
  const [sent, setSent] = useState(false);
  return (
    <button type="button" disabled={sent}
      onClick={() => {
        onFire({ seq: seq + 1, ts: Date.now() });
        setSent(true);
        window.setTimeout(() => setSent(false), 6000);
      }}
      className={cn(
        tile
          ? "flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2 text-center text-[13px] font-semibold leading-tight text-white"
          : "group relative mt-3 flex min-h-[56px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl px-4 text-[17px] font-semibold text-white",
        "bg-[linear-gradient(135deg,#FF9F0A_0%,#FF375F_55%,#BF5AF2_100%)] shadow-[0_8px_24px_-10px_rgba(255,55,95,0.6)]",
        "transition-[transform,filter] duration-150 hover:brightness-110 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-80 touch-manipulation",
      )}>
      {sent ? <Check className={cn("shrink-0", tile ? "h-6 w-6" : "h-5 w-5")} aria-hidden /> : <Sparkles className={cn("shrink-0", tile ? "h-6 w-6" : "h-5 w-5")} aria-hidden />}
      <span aria-live="polite">{sent ? (tile ? "On its way" : "On its way to the wall") : "Motivate me"}</span>
    </button>
  );
}

type Pkg = { id: number; carrier: string | null; what: string | null; eta: string | null; status: string | null; source: string | null; done: boolean; done_at: string | null; first_seen: string | null; last_seen: string | null };

const etaText = (eta: string | null) => {
  if (!eta) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(eta) ? `${eta}T12:00:00` : eta);
  if (isNaN(d.getTime())) return eta;
  const today = new Date(); const tmr = new Date(Date.now() + 864e5);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  return same(d, today) ? "Today" : same(d, tmr) ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

/** Packages on the wall: "Got it" hides one from the wall (wall_package_done); Undo brings it back. */
export function PackagesCard() {
  const [list, setList] = useState<Pkg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await rpc("wall_admin_packages");
    if (error) { setErr(error.message); return; }
    setErr(null);
    setList(Array.isArray(data) ? (data as Pkg[]) : []);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60000); return () => clearInterval(t); }, [load]);

  const mark = async (p: Pkg, done: boolean) => {
    setBusy(p.id);
    setList((l) => l?.map((x) => (x.id === p.id ? { ...x, done } : x)) ?? l);
    const { error } = await rpc("wall_package_done", { p_id: p.id, p_done: done });
    setBusy(null);
    if (error) {
      toast.error(`Didn't go through: ${error.message}`, { id: "wall-pkg" });
      setList((l) => l?.map((x) => (x.id === p.id ? { ...x, done: !done } : x)) ?? l);
      return;
    }
    const name = p.what || p.carrier || "Package";
    if (done) toast.success(`${name}: off the wall.`, { id: "wall-pkg", action: { label: "Undo", onClick: () => void mark({ ...p, done: true }, false) } });
    else toast.success(`${name} is back on the wall.`, { id: "wall-pkg" });
    void load();
  };

  const open = (list ?? []).filter((p) => !p.done);
  const done = (list ?? []).filter((p) => p.done);
  return (
    <Group id="packages" title="Packages"
      footer="Tap Got it when it arrives and it leaves the wall. The list comes from delivery emails and USPS Informed Delivery.">
      {err && <p className="px-4 py-3 text-[15px] text-amber-300">Couldn't load packages: {err}</p>}
      {list == null && !err && <div className="h-[52px] animate-pulse bg-white/[0.03]" aria-busy="true" />}
      {list != null && open.length === 0 && (
        <div className="flex min-h-[52px] items-center gap-3 px-4 py-3 text-[15px] text-white/60">
          <Package className="h-5 w-5 shrink-0 text-white/40" aria-hidden /> Nothing on the way.
        </div>
      )}
      {open.map((p) => (
        <Row key={p.id}
          label={<span className="inline-flex min-w-0 items-center gap-2"><Package className="h-4 w-4 shrink-0 text-white/60" aria-hidden /><span className="truncate">{p.what || p.carrier || "Package"}</span></span>}
          detail={[p.carrier && p.what && !p.what.toLowerCase().includes(p.carrier.toLowerCase()) ? p.carrier : "", p.status ?? "", etaText(p.eta)].filter(Boolean).join(" · ") || undefined}>
          <button type="button" disabled={busy === p.id} onClick={() => void mark(p, true)} className={cn(btn, "shrink-0 px-3 text-[15px]")}
            aria-label={`Got it: ${p.what || p.carrier || "package"}. Hides it from the wall.`}>
            <Check className="h-4 w-4" aria-hidden /> Got it
          </button>
        </Row>
      ))}
      {done.length > 0 && (
        <>
          <button type="button" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}
            className="flex min-h-[48px] w-full items-center gap-3 border-t border-white/[0.07] px-4 py-2 text-left text-[15px] text-sky-400 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
            <span className="flex-1">Got it ({done.length})</span>
            <ChevronDown className={cn("h-5 w-5 text-white/40 transition-transform duration-200 motion-reduce:transition-none", showDone && "rotate-180")} aria-hidden />
          </button>
          {showDone && done.map((p) => (
            <Row key={p.id} dim label={<span className="truncate">{p.what || p.carrier || "Package"}</span>}
              detail={p.done_at ? <>Got it <NW>{new Date(p.done_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</NW></> : undefined}>
              <button type="button" disabled={busy === p.id} onClick={() => void mark(p, false)} className={cn(btn, "shrink-0 px-3 text-[14px]")}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Show again
              </button>
            </Row>
          ))}
        </>
      )}
    </Group>
  );
}
