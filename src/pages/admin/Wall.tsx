/**
 * /admin/wall - remote for the Bestly Wall, the projector strip above Jared's desk
 * (Nebula Capsule 3 on Google TV, driven by bestly-pi). Behind the admin passkey sign-in.
 *
 * Two paths to the Pi, so dragging feels instant and nothing is ever lost:
 *   1. Live: every change is broadcast on a Supabase Realtime topic the Pi listens to
 *      (~100 ms). The topic name comes from wall_admin_get(), admin only.
 *   2. Saved: the same change is written with wall_admin_set / wall_admin_power
 *      (throttled while dragging). The Pi re-reads it as a backup and after restarts.
 * Status comes from the Pi watchdog every minute. See bestly_memory house/wall/projector-strip-v1.
 *
 * Layout follows Apple's HIG: grouped inset sections, one control per job
 * (segmented control, switches, stepper-style nudge pad), 44 pt targets, plain-language labels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, Loader2, Moon, MoonStar,
  Plane, Projector, RotateCcw, Sun, Trash2, Triangle, WifiOff,
} from "lucide-react";

type Pt = [number, number];
type Mode = "auto" | "board" | "ambient" | "demo" | "off";
type WallState = {
  corners: Pt[]; mode: Mode; one: string; mapping: boolean;
  testSweep: boolean; testScout: boolean; away: boolean; mask: Pt[] | null;
};
type PiStatus = {
  status?: string; top?: string; cpu_c?: number | null; heartbeat_age_s?: number | null;
  override?: { on: boolean; until: number } | null; restarts_1h?: number; sync_age_s?: number | null;
};
type Remote = {
  state: WallState; version: number; channel: string; power: { on?: boolean; seq: number; at?: string };
  status: PiStatus | null; status_at: string | null; pulled_at: string | null;
  issues: { key: string; title: string; severity: string; needs: string | null; opened_at: string }[];
};

const DEFAULT_CORNERS: Pt[] = [[0.05, 0.40], [0.95, 0.40], [0.95, 0.55], [0.05, 0.55]];
const MODES: { id: Mode; label: string; about: string }[] = [
  { id: "auto", label: "Auto", about: "Board 7 AM–9 PM, ambient color 9 PM–midnight. The projector sleeps midnight–7 AM." },
  { id: "board", label: "Board", about: "Clock, the one thing, Turo, home and Scout, all day." },
  { id: "ambient", label: "Ambient", about: "Slow color wash with a small clock. Good for evenings." },
  { id: "demo", label: "Demo", about: "Sample wedding welcome to show clients what the service looks like." },
  { id: "off", label: "Black", about: "Projects nothing. The light stays on; use Sleep to turn it off." },
];

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

const secsAgo = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)) : null);
const agoText = (s: number | null) =>
  s == null ? "never" : s < 10 ? "just now" : s < 60 ? `${s} sec ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} hr ago`;
const time12 = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const toF = (c: number) => Math.round((c * 9) / 5 + 32);

/* ───────── building blocks (grouped inset list, Apple style) ───────── */

function Group({ title, footer, children }: { title?: string; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      {title && <h2 className="px-4 text-[13px] font-medium uppercase tracking-[0.06em] text-white/50">{title}</h2>}
      <div className="overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10">{children}</div>
      {footer && <p className="px-4 text-[13px] leading-snug text-white/50">{footer}</p>}
    </section>
  );
}

function Row({ label, detail, children, htmlFor }: { label: React.ReactNode; detail?: React.ReactNode; children?: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 border-b border-white/[0.07] px-4 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-[16px] text-white">{label}</label>
        {detail && <div className="mt-0.5 text-[13px] text-white/50">{detail}</div>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full gap-1 rounded-xl bg-white/[0.07] p-1">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.id)}
            className={cn(
              "flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[14px] font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
              on ? "bg-white text-black shadow-sm" : "text-white/75 hover:text-white",
            )}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const btn =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium text-white ring-1 ring-white/15 " +
  "transition-colors duration-150 hover:bg-white/[0.06] active:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40";

/* ───────── page ───────── */

export default function Wall() {
  const [r, setR] = useState<Remote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tool, setTool] = useState<"corners" | "mask">("corners");
  const [sel, setSel] = useState(0);
  const [fine, setFine] = useState(true);
  const [one, setOne] = useState("");
  const [pending, setPending] = useState(0);
  const [powerMsg, setPowerMsg] = useState<string | null>(null);
  const [, bump] = useState(0);
  const repaint = () => bump((n) => n + 1);

  const S = useRef<WallState | null>(null);
  const dragging = useRef(false);
  const typing = useRef(false);
  const padRef = useRef<HTMLDivElement>(null);
  const chan = useRef<RealtimeChannel | null>(null);
  const liveT = useRef<{ last: number; timer: number | null; next: Partial<WallState> | null }>({ last: 0, timer: null, next: null });
  const saveT = useRef<{ last: number; timer: number | null; next: Partial<WallState> }>({ last: 0, timer: null, next: {} });

  const load = useCallback(async () => {
    const { data, error } = await rpc("wall_admin_get");
    if (error) { setErr(error.message); return; }
    setErr(null);
    const d = data as Remote;
    setR(d);
    if (!dragging.current && saveT.current.timer == null) { S.current = d.state; repaint(); }
    if (!typing.current) setOne(d.state.one ?? "");
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [load]);

  // Live channel to the Pi
  useEffect(() => {
    if (!r?.channel) return;
    const ch = supabase.channel(r.channel, { config: { broadcast: { self: false, ack: false } } });
    ch.subscribe();
    chan.current = ch;
    return () => { void supabase.removeChannel(ch); chan.current = null; };
  }, [r?.channel]);

  /** Broadcast to the wall at most every ~30 ms (always delivers the latest). */
  const sendLive = useCallback((p: Partial<WallState>) => {
    const L = liveT.current;
    L.next = { ...(L.next ?? {}), ...p };
    const fire = () => {
      L.timer = null; L.last = performance.now();
      const payload = L.next; L.next = null;
      if (payload) void chan.current?.send({ type: "broadcast", event: "state", payload });
    };
    const wait = 30 - (performance.now() - L.last);
    if (wait <= 0) fire(); else if (L.timer == null) L.timer = window.setTimeout(fire, wait);
  }, []);

  /** Save to the database at most every 400 ms (always saves the latest). */
  const sendSave = useCallback((p: Partial<WallState>, now = false) => {
    const T = saveT.current;
    T.next = { ...T.next, ...p };
    setPending(1);
    const fire = async () => {
      T.timer = null; T.last = performance.now();
      const payload = T.next; T.next = {};
      const { error } = await rpc("wall_admin_set", { p_patch: payload });
      if (T.timer == null) setPending(0);
      if (error) setErr(`Couldn't save: ${error.message}`);
    };
    if (T.timer != null) window.clearTimeout(T.timer);
    const wait = now ? 0 : Math.max(0, 400 - (performance.now() - T.last));
    T.timer = window.setTimeout(() => void fire(), wait);
  }, []);

  const change = useCallback((p: Partial<WallState>, opts: { now?: boolean } = {}) => {
    if (S.current) { S.current = { ...S.current, ...p }; repaint(); }
    sendLive(p);
    sendSave(p, opts.now ?? true);
  }, [sendLive, sendSave]);

  /* ───── mapping ───── */
  const s = S.current;
  const pts: Pt[] | null = s ? (tool === "mask" ? s.mask : s.corners) : null;

  const move = (i: number, dx: number, dy: number, save: "throttle" | "now" = "throttle") => {
    const cur = S.current; if (!cur) return;
    const key = tool === "mask" ? "mask" : "corners";
    const list = (cur[key] ?? []).map((p) => [...p] as Pt);
    if (!list.length) return;
    const clamp = (v: number) => Math.min(1.5, Math.max(-0.5, v));
    if (i === list.length) list.forEach((p) => { p[0] = clamp(p[0] + dx); p[1] = clamp(p[1] + dy); });
    else { list[i][0] = clamp(list[i][0] + dx); list[i][1] = clamp(list[i][1] + dy); }
    S.current = { ...cur, [key]: list };
    repaint();
    sendLive({ [key]: list });
    sendSave({ [key]: list }, save === "now");
  };

  const startDrag = (i: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dragging.current = true; setSel(i);
    let last = [e.clientX, e.clientY];
    const mv = (ev: PointerEvent) => {
      const rect = padRef.current?.getBoundingClientRect(); if (!rect) return;
      const k = fine ? 0.35 : 1;
      move(i, ((ev.clientX - last[0]) / rect.width) * k, ((ev.clientY - last[1]) / rect.height) * k);
      last = [ev.clientX, ev.clientY];
    };
    const up = () => {
      dragging.current = false;
      el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      const cur = S.current; if (cur) sendSave(tool === "mask" ? { mask: cur.mask } : { corners: cur.corners }, true);
    };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };

  const nudge = (dx: number, dy: number) => {
    const px = fine ? 1 : 10;
    move(sel, (dx * px) / 1920, (dy * px) / 1080, "now");
  };

  const addMask = () => {
    const c = S.current?.corners ?? DEFAULT_CORNERS;
    const [tr, br] = [c[1], c[2]];
    const mask: Pt[] = [[br[0] - 0.12, br[1] + 0.02], [tr[0] + 0.02, tr[1] + (br[1] - tr[1]) * 0.35], [br[0] + 0.02, br[1] + 0.02]];
    setTool("mask"); setSel(0);
    change({ mask, mapping: true });
  };

  const power = async (wantOn: boolean) => {
    setPowerMsg(wantOn ? "Waking…" : "Going to sleep…");
    const { error } = await rpc("wall_admin_power", { p_on: wantOn });
    setPowerMsg(error ? `Didn't go through: ${error.message}` : wantOn ? "Awake. Stays on until midnight." : "Asleep until 7 AM, or until you tap Wake.");
    void load();
  };

  /* ───── status ───── */
  const st = r?.status ?? null;
  const pullAge = secsAgo(r?.pulled_at ?? null);
  const piOnline = pullAge != null && pullAge < 45;
  const statusAge = secsAgo(r?.status_at ?? null);

  const hero = useMemo(() => {
    if (!r) return null;
    if (s?.away) return { tone: "idle", icon: Plane, title: "Away mode", sub: "The Pi leaves the projector alone until you turn this off." };
    if (!piOnline) return { tone: "bad", icon: WifiOff, title: "The Pi isn't checking in", sub: `Last seen ${agoText(pullAge)}. Changes will apply when it's back.` };
    const txt = st?.status ?? "";
    if (txt.startsWith("unreachable")) return { tone: "bad", icon: WifiOff, title: "Projector is offline", sub: "Check it's plugged in and on Wi-Fi." };
    if (txt === "asleep") return { tone: "idle", icon: MoonStar, title: "Projector is asleep", sub: "It wakes at 7 AM. Tap Wake to turn it on now." };
    if (txt.startsWith("in use")) return { tone: "warn", icon: Projector, title: "Projector is showing another app", sub: `${txt.replace("in use: ", "")} is open. The wall comes back when you go to the home screen.` };
    if (txt === "ok") {
      const pageOk = (st?.heartbeat_age_s ?? 999) < 90;
      return pageOk
        ? { tone: "ok", icon: CheckCircle2, title: "On the wall", sub: `Page live${st?.cpu_c != null ? ` · projector ${toF(st.cpu_c)}°F` : ""}` }
        : { tone: "warn", icon: AlertTriangle, title: "Wall page isn't responding", sub: "The watchdog restarts it within a minute." };
    }
    return { tone: "idle", icon: Loader2, title: "Checking…", sub: "" };
  }, [r, s?.away, piOnline, pullAge, st]);

  const toneRing = { ok: "ring-emerald-400/30 bg-emerald-400/[0.06]", warn: "ring-amber-400/30 bg-amber-400/[0.06]", bad: "ring-red-400/35 bg-red-400/[0.07]", idle: "ring-white/10 bg-white/[0.04]" } as const;
  const toneIcon = { ok: "text-emerald-400", warn: "text-amber-400", bad: "text-red-400", idle: "text-white/60" } as const;

  const sync = !r ? null : !piOnline
    ? { dot: "bg-red-400", text: "Pi offline" }
    : pending > 0
      ? { dot: "bg-amber-400 animate-pulse", text: "Saving…" }
      : { dot: "bg-emerald-400", text: "Live" };

  if (!r || !s) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title="Wall" description="The projector strip above your desk." />
        {err ? (
          <p className="rounded-2xl bg-red-500/10 p-4 text-[15px] text-red-200 ring-1 ring-red-500/30">{err}</p>
        ) : (
          <div className="space-y-4" aria-busy="true">
            {[88, 120, 260].map((h) => <div key={h} className="animate-pulse rounded-2xl bg-white/[0.05]" style={{ height: h }} />)}
          </div>
        )}
      </div>
    );
  }

  const modeAbout = MODES.find((m) => m.id === s.mode)?.about;
  const handles: Pt[] = pts ? [...pts, pts.reduce<Pt>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0])] : [];

  return (
    <div className="mx-auto max-w-2xl space-y-7 pb-10">
      <PageHeader
        title="Wall"
        description="The projector strip above your desk. Changes show up as you make them."
        actions={sync && (
          <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-[13px] text-white/80 ring-1 ring-white/10" aria-live="polite">
            <span className={cn("h-2 w-2 rounded-full", sync.dot)} /> {sync.text}
          </span>
        )}
      />

      {err && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl bg-red-500/10 p-4 text-[15px] text-red-200 ring-1 ring-red-500/30">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> <span className="flex-1">{err}</span>
          <button type="button" className="text-[15px] font-medium underline underline-offset-2" onClick={() => { setErr(null); void load(); }}>Try again</button>
        </div>
      )}

      {/* Status */}
      {hero && (
        <section className={cn("rounded-2xl p-4 ring-1", toneRing[hero.tone as keyof typeof toneRing])}>
          <div className="flex items-start gap-3">
            <hero.icon className={cn("mt-0.5 h-6 w-6 shrink-0", toneIcon[hero.tone as keyof typeof toneIcon], hero.icon === Loader2 && "animate-spin")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-semibold text-white">{hero.title}</div>
              {hero.sub && <div className="mt-0.5 text-[15px] text-white/65">{hero.sub}</div>}
              <div className="mt-2 text-[13px] text-white/45">
                Last check {agoText(statusAge)}
                {st?.override && st.override.until * 1000 > Date.now() && ` · held ${st.override.on ? "awake" : "asleep"} until ${time12(st.override.until * 1000)}`}
              </div>
            </div>
          </div>
          {!!r.issues?.length && (
            <ul className="mt-3 space-y-2 border-t border-white/10 pt-3">
              {r.issues.map((i) => (
                <li key={i.key} className="flex items-start gap-2 text-[15px]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
                  <span><span className="text-white">{i.title}</span>{i.needs && <span className="block text-white/60">{i.needs}</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* The one thing */}
      <Group title="Now" footer="Shows in big letters in the middle of the wall.">
        <div className="flex items-center gap-2 px-4 py-2">
          <label htmlFor="wall-one" className="sr-only">The one thing</label>
          <input
            id="wall-one" type="text" maxLength={80} value={one} autoComplete="off" enterKeyHint="done"
            placeholder="What are you working on?"
            onFocus={() => (typing.current = true)}
            onBlur={() => { typing.current = false; }}
            onChange={(e) => { setOne(e.target.value); change({ one: e.target.value }, { now: false }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="min-h-[44px] flex-1 bg-transparent text-[17px] text-white placeholder:text-white/35 focus:outline-none"
          />
          {one && (
            <button type="button" className="min-h-[44px] px-2 text-[15px] text-sky-400" onClick={() => { setOne(""); change({ one: "" }); }}>Clear</button>
          )}
        </div>
      </Group>

      {/* Mode */}
      <Group title="Mode" footer={modeAbout}>
        <div className="p-2">
          <Segmented label="Mode" value={s.mode} onChange={(m) => change({ mode: m })}
            options={MODES.map((m) => ({ id: m.id, label: m.label }))} />
        </div>
      </Group>

      {/* Layout */}
      <Group title="Layout"
        footer={tool === "corners"
          ? "The black box is the projector's whole picture. Drag the white dots onto the corners of your strip. The blue dot moves everything."
          : "Drag the orange dots over the shadow where the TV blocks the light. The wall stays dark there and moves text out of the way."}>
        <Row label="Show guides on the wall" detail="Outlines the strip and blocked area so you can line them up." htmlFor="wall-guides">
          <Switch id="wall-guides" checked={s.mapping} onCheckedChange={(v) => change({ mapping: v })} />
        </Row>
        <div className="space-y-3 px-4 py-3">
          <Segmented label="What to adjust" value={tool}
            onChange={(t) => { if (t === "mask" && !s.mask) addMask(); else { setTool(t); setSel(0); } }}
            options={[{ id: "corners", label: "Strip corners" }, { id: "mask", label: <><Triangle className="h-4 w-4" aria-hidden /> Blocked area</> }]} />

          <div ref={padRef} className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-xl ring-1 ring-white/15" style={{ background: "#000" }}>
            <svg viewBox="0 0 1600 900" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
              <polygon points={s.corners.map(([x, y]) => `${x * 1600},${y * 900}`).join(" ")}
                fill="rgba(255,248,236,0.14)" stroke="#FFF8EC" strokeWidth={tool === "corners" ? 5 : 3} />
              {s.mask && (
                <polygon points={s.mask.map(([x, y]) => `${x * 1600},${y * 900}`).join(" ")}
                  fill="rgba(255,149,0,0.28)" stroke="#FF9500" strokeWidth={tool === "mask" ? 5 : 3} />
              )}
            </svg>
            {handles.map((p, i) => {
              const isAll = i === handles.length - 1;
              return (
                <button key={`${tool}-${i}`} type="button"
                  aria-label={isAll ? "Move the whole shape" : `${tool === "mask" ? "Blocked area" : "Corner"} point ${i + 1}`}
                  aria-pressed={sel === i}
                  onPointerDown={startDrag(i)} onFocus={() => setSel(i)}
                  onKeyDown={(e) => {
                    const k: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
                    if (k[e.key]) { e.preventDefault(); nudge(...k[e.key]); }
                  }}
                  style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
                  className="absolute -ml-[22px] -mt-[22px] flex h-11 w-11 touch-none items-center justify-center rounded-full focus-visible:outline-none">
                  <span className={cn(
                    "block h-5 w-5 rounded-full border-[2.5px] shadow-[0_0_0_2px_rgba(0,0,0,0.55)] transition-transform duration-100",
                    isAll ? "border-white bg-sky-400" : tool === "mask" ? "border-white bg-orange-400" : "border-black bg-[#FFF8EC]",
                    sel === i && "scale-125 ring-4 ring-sky-400/70",
                  )} />
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Nudge the selected point">
              <span />
              <button type="button" aria-label="Nudge up" className={cn(btn, "w-11 px-0")} onClick={() => nudge(0, -1)}><ArrowUp className="h-5 w-5" /></button>
              <span />
              <button type="button" aria-label="Nudge left" className={cn(btn, "w-11 px-0")} onClick={() => nudge(-1, 0)}><ArrowLeft className="h-5 w-5" /></button>
              <span className="flex h-11 w-11 items-center justify-center text-[12px] text-white/45">{sel === handles.length - 1 ? "All" : sel + 1}</span>
              <button type="button" aria-label="Nudge right" className={cn(btn, "w-11 px-0")} onClick={() => nudge(1, 0)}><ArrowRight className="h-5 w-5" /></button>
              <span />
              <button type="button" aria-label="Nudge down" className={cn(btn, "w-11 px-0")} onClick={() => nudge(0, 1)}><ArrowDown className="h-5 w-5" /></button>
              <span />
            </div>
            <div className="min-w-[180px] flex-1 space-y-2">
              <Segmented label="Drag precision" value={fine ? "fine" : "fast"} onChange={(v) => setFine(v === "fine")}
                options={[{ id: "fine", label: "Precise" }, { id: "fast", label: "Fast" }]} />
              {tool === "corners" ? (
                <button type="button" className={cn(btn, "w-full")} onClick={() => change({ corners: DEFAULT_CORNERS })}>
                  <RotateCcw className="h-4 w-4" aria-hidden /> Reset corners
                </button>
              ) : (
                <div className="flex gap-2">
                  {s.mask && s.mask.length < 6 && (
                    <button type="button" className={cn(btn, "flex-1")} onClick={() => {
                      const m = s.mask!; const a = m[m.length - 1], b = m[0];
                      change({ mask: [...m, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]] });
                    }}>Add point</button>
                  )}
                  <button type="button" className={cn(btn, "flex-1 text-red-400")} onClick={() => { change({ mask: null }); setTool("corners"); setSel(0); }}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </Group>

      {/* Alerts */}
      <Group title="Test alerts" footer="Real alerts show on their own: move the car on sweeping mornings, and anything Scout flags.">
        <Row label="Move-car alert" htmlFor="wall-t-sweep">
          <Switch id="wall-t-sweep" checked={s.testSweep} onCheckedChange={(v) => change({ testSweep: v })} />
        </Row>
        <Row label="Scout alert" htmlFor="wall-t-scout">
          <Switch id="wall-t-scout" checked={s.testScout} onCheckedChange={(v) => change({ testScout: v })} />
        </Row>
      </Group>

      {/* Projector */}
      <Group title="Projector" footer={powerMsg ?? "Wake and Sleep hold until the next switch at 7 AM or midnight."}>
        <div className="grid grid-cols-2 gap-2 p-2">
          <button type="button" className={btn} onClick={() => void power(true)}><Sun className="h-5 w-5" aria-hidden /> Wake</button>
          <button type="button" className={btn} onClick={() => void power(false)}><Moon className="h-5 w-5" aria-hidden /> Sleep</button>
        </div>
        <Row label="Away mode" detail="Taking it to a gig. The Pi won't wake it, open the wall or send offline alerts." htmlFor="wall-away">
          <Switch id="wall-away" checked={s.away} onCheckedChange={(v) => change({ away: v })} />
        </Row>
      </Group>
    </div>
  );
}
