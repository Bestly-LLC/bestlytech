/**
 * /admin/wall - remote for the Bestly Wall, the projector strip above Jared's desk
 * (Nebula Capsule 3 on Google TV, driven by bestly-pi). Behind the admin passkey sign-in.
 *
 * The database row wall_state is the source of truth. This page reads it with
 * wall_admin_get() and writes with wall_admin_set(patch) / wall_admin_power(on).
 * The Pi pulls changes every ~1 s while mapping (6 s otherwise) and pushes a status
 * snapshot every minute from its watchdog. See bestly_memory house/wall/projector-strip-v1.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2, Moon, Plane, RefreshCw, Sun, Triangle } from "lucide-react";

type Pt = [number, number];
type WallState = {
  corners: Pt[]; mode: "auto" | "board" | "ambient" | "demo" | "off"; one: string;
  mapping: boolean; testSweep: boolean; testScout: boolean; away: boolean; mask: Pt[] | null;
};
type PiStatus = {
  status?: string; awake?: boolean; top?: string; cpu_c?: number | null; heartbeat_age_s?: number | null;
  want_on?: boolean; override?: { on: boolean; until: number } | null; restarts_1h?: number; sync_age_s?: number | null;
};
type Remote = {
  state: WallState; version: number; power: { on?: boolean; seq: number; at?: string };
  status: PiStatus | null; status_at: string | null; pulled_at: string | null;
  issues: { key: string; title: string; severity: string; needs: string | null; opened_at: string }[];
};

const DEFAULT_CORNERS: Pt[] = [[0.05, 0.40], [0.95, 0.40], [0.95, 0.55], [0.05, 0.55]];
const MODES: { id: WallState["mode"]; label: string }[] = [
  { id: "auto", label: "Auto" }, { id: "board", label: "Board" }, { id: "ambient", label: "Ambient" },
  { id: "demo", label: "Client demo" }, { id: "off", label: "Black" },
];

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

const secsAgo = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)) : null);
const agoText = (s: number | null) =>
  s == null ? "never" : s < 60 ? `${s} sec ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} hr ago`;
const time12 = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10", className)}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/50">{title}</h2>
      {children}
    </section>
  );
}

function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "idle"; children: React.ReactNode }) {
  const t = {
    ok: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25",
    warn: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
    bad: "bg-red-500/10 text-red-300 ring-red-500/30",
    idle: "bg-white/[0.05] text-white/60 ring-white/10",
  }[tone];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1", t)}>{children}</span>;
}

const btn = "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ring-1 ring-white/15 text-white/85 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50";
const on = "bg-white text-neutral-900 ring-white hover:bg-white/90";

export default function Wall() {
  const [r, setR] = useState<Remote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tool, setTool] = useState<"corners" | "mask">("corners");
  const [sel, setSel] = useState(0);
  const [fine, setFine] = useState(true);
  const [one, setOne] = useState("");
  const [powerMsg, setPowerMsg] = useState<string | null>(null);
  const S = useRef<WallState | null>(null);
  const dragging = useRef(false);
  const oneFocused = useRef(false);
  const padRef = useRef<HTMLDivElement>(null);
  const sendTimer = useRef<number | null>(null);
  const [, force] = useState(0);
  const repaint = () => force((n) => n + 1);

  const load = useCallback(async () => {
    const { data, error } = await rpc("wall_admin_get");
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setErr(null);
    const d = data as Remote;
    setR(d);
    if (!dragging.current) { S.current = d.state; repaint(); }
    if (!oneFocused.current) setOne(d.state.one ?? "");
  }, []);

  useEffect(() => { void load(); const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [load]);

  const patch = useCallback(async (p: Partial<WallState>) => {
    if (S.current) { S.current = { ...S.current, ...p }; repaint(); }
    const { error } = await rpc("wall_admin_set", { p_patch: p });
    if (error) setErr(error.message);
  }, []);

  const sendShape = useCallback(() => {
    if (sendTimer.current) window.clearTimeout(sendTimer.current);
    sendTimer.current = window.setTimeout(() => {
      const s = S.current; if (!s) return;
      void rpc("wall_admin_set", { p_patch: tool === "mask" ? { mask: s.mask } : { corners: s.corners } });
    }, 120);
  }, [tool]);

  const points = (): Pt[] | null => {
    const s = S.current; if (!s) return null;
    return tool === "mask" ? s.mask : s.corners;
  };

  const move = (i: number, dx: number, dy: number) => {
    const s = S.current; if (!s) return;
    const key = tool === "mask" ? "mask" : "corners";
    const pts = (s[key] ?? []).map((p) => [...p] as Pt);
    if (!pts.length) return;
    const clamp = (v: number) => Math.min(1.5, Math.max(-0.5, v));
    if (i === pts.length) pts.forEach((p) => { p[0] = clamp(p[0] + dx); p[1] = clamp(p[1] + dy); });
    else { pts[i][0] = clamp(pts[i][0] + dx); pts[i][1] = clamp(pts[i][1] + dy); }
    S.current = { ...s, [key]: pts };
    repaint(); sendShape();
  };

  const startDrag = (i: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true; setSel(i);
    let last = [e.clientX, e.clientY];
    const el = e.currentTarget;
    const mv = (ev: PointerEvent) => {
      const rect = padRef.current?.getBoundingClientRect(); if (!rect) return;
      const k = fine ? 0.35 : 1;
      move(i, ((ev.clientX - last[0]) / rect.width) * k, ((ev.clientY - last[1]) / rect.height) * k);
      last = [ev.clientX, ev.clientY];
    };
    const up = () => { dragging.current = false; el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up);
  };

  const addMask = () => {
    const c = S.current?.corners ?? DEFAULT_CORNERS;
    const [tr, br] = [c[1], c[2]];
    // A starting triangle over the bottom-right of the strip, where the TV sits.
    const mask: Pt[] = [[br[0] - 0.12, br[1] + 0.02], [tr[0] + 0.02, tr[1] + (br[1] - tr[1]) * 0.35], [br[0] + 0.02, br[1] + 0.02]];
    setTool("mask"); setSel(0);
    void patch({ mask, mapping: true });
  };

  const power = async (want: boolean) => {
    setPowerMsg(want ? "Waking the projector…" : "Putting the projector to sleep…");
    const { error } = await rpc("wall_admin_power", { p_on: want });
    setPowerMsg(error ? error.message : want ? "Wake sent. It holds until midnight." : "Sleep sent. It holds until 7 AM, or until you tap Wake.");
    void load();
  };

  const s = S.current;
  const st = r?.status ?? null;
  const statusAge = secsAgo(r?.status_at ?? null);
  const pullAge = secsAgo(r?.pulled_at ?? null);
  const piOnline = pullAge != null && pullAge < 60;
  const projector = (() => {
    if (!r) return { tone: "idle" as const, text: "Loading" };
    if (s?.away) return { tone: "idle" as const, text: "Away mode" };
    if (!piOnline) return { tone: "bad" as const, text: "Pi not checking in" };
    const txt = st?.status ?? "";
    if (txt.startsWith("unreachable")) return { tone: "bad" as const, text: "Projector offline" };
    if (txt === "asleep") return { tone: "idle" as const, text: "Asleep" };
    if (txt.startsWith("in use")) return { tone: "warn" as const, text: `In use: ${txt.replace("in use: ", "")}` };
    if (txt === "ok") return { tone: "ok" as const, text: "Showing the wall" };
    return { tone: "warn" as const, text: txt || "Checking" };
  })();

  const pts = points();
  const quad = s?.corners ?? DEFAULT_CORNERS;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Wall"
        description="The projector strip above your desk. Changes show on the wall within a second or two."
        actions={
          <button type="button" onClick={() => void load()} className={btn}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        }
      />

      {err && (
        <div className="flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      <Card title="Right now">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={projector.tone}>{projector.text}</Pill>
          {st?.heartbeat_age_s != null && st.status === "ok" && (
            <Pill tone={st.heartbeat_age_s < 90 ? "ok" : "bad"}>{st.heartbeat_age_s < 90 ? "Page live" : "Page not responding"}</Pill>
          )}
          {st?.cpu_c != null && <Pill tone={st.cpu_c >= 75 ? "warn" : "idle"}>{Math.round(st.cpu_c)}°C</Pill>}
          {st?.override && st.override.until * 1000 > Date.now() && (
            <Pill tone="idle">{st.override.on ? "Held awake" : "Held asleep"} until {time12(st.override.until * 1000)}</Pill>
          )}
        </div>
        <p className="mt-2 text-xs text-white/45">Last check from the Pi {agoText(statusAge)}.</p>
        {!!r?.issues?.length && (
          <ul className="mt-3 space-y-2">
            {r.issues.map((i) => (
              <li key={i.key} className="rounded-xl bg-red-500/[0.07] p-3 text-sm ring-1 ring-red-500/25">
                <div className="font-medium text-red-200">{i.title}</div>
                {i.needs && <div className="mt-1 text-red-200/70">{i.needs}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="The one thing">
        <input
          id="wall-one"
          type="text"
          maxLength={80}
          value={one}
          placeholder="What are you doing right now?"
          onFocus={() => (oneFocused.current = true)}
          onBlur={() => { oneFocused.current = false; void patch({ one }); }}
          onChange={(e) => {
            setOne(e.target.value);
            if (sendTimer.current) window.clearTimeout(sendTimer.current);
            const v = e.target.value;
            sendTimer.current = window.setTimeout(() => void rpc("wall_admin_set", { p_patch: { one: v } }), 400);
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-full rounded-xl bg-black/40 px-3 py-3 text-lg font-medium text-white ring-1 ring-white/15 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </Card>

      <Card title="Mode">
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={s?.mode === m.id} onClick={() => void patch({ mode: m.id })}
              className={cn(btn, "flex-1", s?.mode === m.id && on)}>{m.label}</button>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/45">Auto shows the board 7 AM–9 PM and ambient color 9 PM–midnight. The projector sleeps midnight–7 AM.</p>
      </Card>

      <Card title="Map the wall">
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!!s?.mapping} onClick={() => void patch({ mapping: !s?.mapping })} className={cn(btn, "flex-1", s?.mapping && on)}>
            {s?.mapping ? "Hide guides on the wall" : "Show guides on the wall"}
          </button>
          <div className="flex flex-1 gap-2">
            <button type="button" aria-pressed={tool === "corners"} onClick={() => { setTool("corners"); setSel(0); }} className={cn(btn, "flex-1", tool === "corners" && on)}>Strip corners</button>
            <button type="button" aria-pressed={tool === "mask"} onClick={() => { if (!s?.mask) addMask(); else { setTool("mask"); setSel(0); } }} className={cn(btn, "flex-1", tool === "mask" && on)}>
              <Triangle className="h-4 w-4" /> Blocked area
            </button>
          </div>
        </div>

        <div ref={padRef} className="relative mt-3 aspect-video w-full touch-none overflow-hidden rounded-lg bg-black ring-1 ring-white/15">
          <svg viewBox="0 0 1600 900" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <polygon points={quad.map(([x, y]) => `${x * 1600},${y * 900}`).join(" ")} fill="rgba(255,248,236,.12)" stroke="#fff" strokeWidth={4} />
            {s?.mask && (
              <polygon points={s.mask.map(([x, y]) => `${x * 1600},${y * 900}`).join(" ")} fill="rgba(255,75,62,.3)" stroke="#FF4B3E" strokeWidth={4} />
            )}
          </svg>
          {pts && [...pts, pts.reduce<Pt>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0])].map((p, i) => (
            <div key={`${tool}-${i}`} role="slider" tabIndex={0} aria-label={i === pts.length ? "Move all" : `Point ${i + 1}`}
              onPointerDown={startDrag(i)} onFocus={() => setSel(i)}
              style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
              className={cn("absolute -ml-[15px] -mt-[15px] h-[30px] w-[30px] touch-none rounded-full border-[3px] border-white",
                i === pts.length ? "bg-sky-400" : tool === "mask" ? "bg-orange-400" : "bg-red-500",
                sel === i && "ring-4 ring-amber-400")} />
          ))}
        </div>
        <p className="mt-2 text-xs text-white/45">
          {tool === "corners"
            ? "The black box is the projector's whole picture. Drag the red dots until the corners sit on your strip. Blue moves everything."
            : "Drag the orange dots over the shadow where the TV blocks the light. The wall stays dark there and moves text out of the way."}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="grid grid-cols-3 gap-1.5">
            <span />
            <button type="button" aria-label="Nudge up" className={btn} onClick={() => move(sel, 0, -(fine ? 1 : 8) / 1080)}><ArrowUp className="h-4 w-4" /></button>
            <span />
            <button type="button" aria-label="Nudge left" className={btn} onClick={() => move(sel, -(fine ? 1 : 8) / 1920, 0)}><ArrowLeft className="h-4 w-4" /></button>
            <button type="button" aria-pressed={fine} className={cn(btn, fine && on)} onClick={() => setFine(!fine)}>Fine</button>
            <button type="button" aria-label="Nudge right" className={btn} onClick={() => move(sel, (fine ? 1 : 8) / 1920, 0)}><ArrowRight className="h-4 w-4" /></button>
            <span />
            <button type="button" aria-label="Nudge down" className={btn} onClick={() => move(sel, 0, (fine ? 1 : 8) / 1080)}><ArrowDown className="h-4 w-4" /></button>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {tool === "corners" ? (
              <button type="button" className={btn} onClick={() => void patch({ corners: DEFAULT_CORNERS })}>Reset corners</button>
            ) : (
              <>
                {s?.mask && s.mask.length < 6 && (
                  <button type="button" className={btn} onClick={() => {
                    const m = s.mask!; const a = m[m.length - 1], b = m[0];
                    void patch({ mask: [...m, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]] });
                  }}>Add a point</button>
                )}
                <button type="button" className={btn} onClick={() => { void patch({ mask: null }); setTool("corners"); setSel(0); }}>Remove blocked area</button>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card title="Test alerts">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={!!s?.testSweep} onClick={() => void patch({ testSweep: !s?.testSweep })}
            className={cn(btn, s?.testSweep && "bg-red-500 text-white ring-red-500 hover:bg-red-500/90")}>Move-car alert</button>
          <button type="button" aria-pressed={!!s?.testScout} onClick={() => void patch({ testScout: !s?.testScout })}
            className={cn(btn, s?.testScout && "bg-red-500 text-white ring-red-500 hover:bg-red-500/90")}>Scout alert</button>
        </div>
      </Card>

      <Card title="Projector">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={btn} onClick={() => void power(true)}><Sun className="h-4 w-4" /> Wake</button>
          <button type="button" className={btn} onClick={() => void power(false)}><Moon className="h-4 w-4" /> Sleep</button>
        </div>
        {powerMsg && <p className="mt-2 text-xs text-white/60">{powerMsg}</p>}
        <button type="button" aria-pressed={!!s?.away} onClick={() => void patch({ away: !s?.away })} className={cn(btn, "mt-3 w-full", s?.away && on)}>
          <Plane className="h-4 w-4" /> {s?.away ? "Away mode is on. Tap when it's back home." : "Away mode (taking it to a gig)"}
        </button>
        <p className="mt-2 text-xs text-white/45">Away mode stops the Pi from waking the projector, opening the wall, or sending offline alerts.</p>
      </Card>
    </div>
  );
}
