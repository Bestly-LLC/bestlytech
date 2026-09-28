/**
 * Admin › Wall › Advanced › Neon sign (W8, round 4, 2026-09-28).
 *
 * The white neon line-art sign on the sign wall (legs kicking up out of a pool, grid cells C6–C7) is projection-mapped:
 * the wall page (wall.html, "LED sign" layer) has a traced vector of its tubes pinned in projector space. This section
 * fine-aligns it (nudge, size, turn, width), picks the idle look (lit / breathe / color wash / light trace / off) and
 * color, and plays the short notification animations so Jared can see them. All of it is state.ledSign
 * {on, look, color, x, y, s, r, sx, outline, notify, shield, test}; the DB cleans it in wall_clean_ledsign().
 *
 * HIG: one grouped inset list per job, 44 pt targets, plain-language labels, numbers never wrap from their units,
 * nudging turns the outline on by itself so the effect of each tap is visible on the wall.
 */
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Plus, RotateCcw, RotateCw, Play, MoveHorizontal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type LedSignLook = "lit" | "breathe" | "wash" | "trace" | "none";
export type LedSignFx = "sign" | "turo" | "motivate" | "scout" | "hello";
export type LedSign = {
  on: boolean; look: LedSignLook; color: string;
  /** offset as a share of the projector picture (0..1), size, turn in degrees, extra width */
  x: number; y: number; s: number; r: number; sx: number;
  outline: boolean; notify: boolean; shield: boolean;
  test?: { fx: LedSignFx; at: number } | null;
};
/** What the wall page reports in its heartbeat (via the watchdog status). */
export type LedSignHealth = { ok?: boolean; errs?: number; err?: string | null; align?: "state" | "default"; vis?: boolean; fx?: number; last?: string | null; ms?: number } | null | undefined;

export const LED_DEFAULT: LedSign = { on: true, look: "lit", color: "#F4EEFF", x: 0, y: 0, s: 1, r: 0, sx: 1, outline: false, notify: true, shield: true, test: null };

const LOOKS: { id: LedSignLook; label: string }[] = [
  { id: "lit", label: "Lit" }, { id: "breathe", label: "Breathe" }, { id: "wash", label: "Color" }, { id: "trace", label: "Trace" }, { id: "none", label: "Off" },
];
const LOOK_HELP: Record<LedSignLook, string> = {
  lit: "Glows like it's switched on, even when it's off.",
  breathe: "Glows and slowly breathes brighter and softer.",
  wash: "Drifts slowly through violet, pink and blue.",
  trace: "A light keeps running along the tubes.",
  none: "No glow. The sign still reacts to alerts if that's on.",
};
const COLORS: { hex: string; name: string }[] = [
  { hex: "#F4EEFF", name: "Cool white" }, { hex: "#FFF1DC", name: "Warm white" }, { hex: "#FF6FD8", name: "Pink" },
  { hex: "#A78BFA", name: "Violet" }, { hex: "#64D2FF", name: "Blue" }, { hex: "#FFB340", name: "Amber" },
];
const PLAYS: { fx: LedSignFx; label: string }[] = [
  { fx: "sign", label: "New signature" }, { fx: "turo", label: "Turo booking" }, { fx: "motivate", label: "Motivate me" }, { fx: "scout", label: "Scout alert" },
];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const NW = ({ children }: { children: React.ReactNode }) => <span className="whitespace-nowrap">{children}</span>;
const btn =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl px-3 text-[15px] font-medium text-white ring-1 ring-white/15 " +
  "transition-colors duration-150 hover:bg-white/[0.06] active:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40 touch-manipulation";
const swHit = "relative after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']";

function Row({ label, detail, htmlFor, children }: { label: React.ReactNode; detail?: React.ReactNode; htmlFor?: string; children?: React.ReactNode }) {
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

export function WallLedSign({ value, health, onChange }: { value: Partial<LedSign> | null | undefined; health?: LedSignHealth; onChange: (v: LedSign) => void }) {
  const v: LedSign = { ...LED_DEFAULT, ...(value ?? {}) };
  const set = (p: Partial<LedSign>) => onChange({ ...v, ...p });
  /** Alignment taps also switch the outline on, so each tap shows up on the wall right away. */
  const nudge = (p: Partial<LedSign>) => set({ ...p, outline: true });
  const STEP = 0.0015; // ~1.5 px of the 960 px picture

  const px = (n: number, full: number) => Math.round(n * full);
  const off = `${px(v.x, 960) >= 0 ? "+" : ""}${px(v.x, 960)} / ${px(v.y, 540) >= 0 ? "+" : ""}${px(v.y, 540)}`;
  const status = !health ? null
    : health.ok === false ? `Paused animations after an error${health.err ? ` (${health.err})` : ""}. They come back by themselves in 10 min.`
    : health.align === "default" ? "Using the built-in alignment (none saved yet)."
    : health.vis ? "Glow is on the wall." : "Glow is off right now (wall asleep or switched off).";

  return (
    <section id="neon-sign" className="scroll-mt-20 space-y-2">
      <h2 className="px-4 text-[13px] font-medium uppercase tracking-[0.06em] text-white/50">Neon sign</h2>
      <div className="overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
        <Row label="Make the sign glow" detail="The projector lights the neon tubes so the sign looks on, even when it's unplugged." htmlFor="ls-on">
          <Switch className={swHit} id="ls-on" checked={v.on} onCheckedChange={(on) => set({ on })} />
        </Row>
        <div className="space-y-2 border-b border-white/[0.07] px-4 py-3">
          <div role="radiogroup" aria-label="Sign look" className="flex w-full gap-1 rounded-xl bg-white/[0.07] p-1">
            {LOOKS.map((o) => {
              const on = o.id === v.look;
              return (
                <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => set({ look: o.id })}
                  className={cn("flex min-h-[40px] min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-1 text-[13px] font-medium transition-colors duration-150 touch-manipulation sm:text-[14px]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400", on ? "bg-white text-black shadow-sm" : "text-white/75 hover:text-white")}>
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="text-[13px] text-white/55">{LOOK_HELP[v.look]}</p>
          <div role="radiogroup" aria-label="Glow color" className="flex flex-wrap gap-2 pt-1">
            {COLORS.map((c) => {
              const on = c.hex.toLowerCase() === v.color.toLowerCase();
              return (
                <button key={c.hex} type="button" role="radio" aria-checked={on} aria-label={c.name} title={c.name} onClick={() => set({ color: c.hex })}
                  className={cn("relative flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-white/15 transition-transform duration-150 active:scale-95 touch-manipulation",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400", on && "ring-2 ring-white")}>
                  <span className="h-7 w-7 rounded-full" style={{ background: c.hex, boxShadow: `0 0 12px ${c.hex}` }} />
                </button>
              );
            })}
          </div>
          {v.look === "wash" && <p className="text-[13px] text-white/45">Color drifts on its own in this look.</p>}
        </div>
        <Row label="React to alerts" detail="Short sign animations for a new signature, a Turo booking, Motivate me and Scout alerts. Quiet during Do Not Disturb and at night." htmlFor="ls-notify">
          <Switch className={swHit} id="ls-notify" checked={v.notify} onCheckedChange={(notify) => set({ notify })} />
        </Row>
        <Row label="Keep other wall content off it" detail="Blacks out the clear acrylic so signatures and pictures never land on the sign." htmlFor="ls-shield">
          <Switch className={swHit} id="ls-shield" checked={v.shield} onCheckedChange={(shield) => set({ shield })} />
        </Row>
        <div className="space-y-2 px-4 py-3">
          <div className="text-[13px] font-medium text-white/60">Play on the wall</div>
          <div className="grid grid-cols-2 gap-2">
            {PLAYS.map((p) => (
              <button key={p.fx} type="button" className={btn}
                onClick={() => { set({ test: { fx: p.fx, at: Date.now() }, outline: false }); toast.success(`Playing "${p.label}" on the sign.`, { id: "wall-act" }); }}>
                <Play className="h-4 w-4" aria-hidden /> {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="px-4 text-[13px] leading-snug text-white/50">{status ?? "The wall reports back within a minute."}</p>

      <h2 className="px-4 pt-3 text-[13px] font-medium uppercase tracking-[0.06em] text-white/50">Line up the neon sign</h2>
      <div className="overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
        <Row label="Show outline on the wall" detail="Thin white lines should sit right on the tubes. Nudge until they do." htmlFor="ls-outline">
          <Switch className={swHit} id="ls-outline" checked={v.outline} onCheckedChange={(outline) => set({ outline })} />
        </Row>
        <div className="flex flex-col items-center gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Move the sign outline">
            <span />
            <button type="button" className={btn} aria-label="Move up" onClick={() => nudge({ y: r4(clamp(v.y - STEP, -0.3, 0.3)) })}><ArrowUp className="h-5 w-5" aria-hidden /></button>
            <span />
            <button type="button" className={btn} aria-label="Move left" onClick={() => nudge({ x: r4(clamp(v.x - STEP, -0.3, 0.3)) })}><ArrowLeft className="h-5 w-5" aria-hidden /></button>
            <div className="flex min-h-[44px] items-center justify-center text-center text-[12px] tabular-nums leading-tight text-white/55"><NW>{off}</NW></div>
            <button type="button" className={btn} aria-label="Move right" onClick={() => nudge({ x: r4(clamp(v.x + STEP, -0.3, 0.3)) })}><ArrowRight className="h-5 w-5" aria-hidden /></button>
            <span />
            <button type="button" className={btn} aria-label="Move down" onClick={() => nudge({ y: r4(clamp(v.y + STEP, -0.3, 0.3)) })}><ArrowDown className="h-5 w-5" aria-hidden /></button>
            <span />
          </div>
          <div className="grid w-full max-w-[260px] grid-cols-2 gap-2" role="group" aria-label="Size, turn and width">
            <button type="button" className={btn} onClick={() => nudge({ s: r4(clamp(v.s - 0.01, 0.4, 2.5)) })}><Minus className="h-4 w-4" aria-hidden /> Smaller</button>
            <button type="button" className={btn} onClick={() => nudge({ s: r4(clamp(v.s + 0.01, 0.4, 2.5)) })}><Plus className="h-4 w-4" aria-hidden /> Bigger</button>
            <button type="button" className={btn} onClick={() => nudge({ r: r4(clamp(v.r - 0.5, -45, 45)) })}><RotateCcw className="h-4 w-4" aria-hidden /> Turn left</button>
            <button type="button" className={btn} onClick={() => nudge({ r: r4(clamp(v.r + 0.5, -45, 45)) })}><RotateCw className="h-4 w-4" aria-hidden /> Turn right</button>
            <button type="button" className={btn} onClick={() => nudge({ sx: r4(clamp(v.sx - 0.01, 0.6, 1.6)) })}><MoveHorizontal className="h-4 w-4" aria-hidden /> Narrower</button>
            <button type="button" className={btn} onClick={() => nudge({ sx: r4(clamp(v.sx + 0.01, 0.6, 1.6)) })}><MoveHorizontal className="h-4 w-4" aria-hidden /> Wider</button>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-white/[0.07] px-4 py-3">
          <p className="min-w-0 flex-1 text-[13px] tabular-nums text-white/55">
            <NW>Size {Math.round(v.s * 100)}%</NW> · <NW>Turn {v.r.toFixed(1)}°</NW> · <NW>Width {Math.round(v.sx * 100)}%</NW>
          </p>
          <button type="button" className={btn}
            onClick={() => { set({ x: 0, y: 0, s: 1, r: 0, sx: 1, outline: true }); toast.success("Back to the traced position.", { id: "wall-act" }); }}>
            Reset
          </button>
        </div>
      </div>
      <p className="px-4 text-[13px] leading-snug text-white/50">
        Each arrow moves it about 1.5 projector pixels. Turn the outline off when it lines up; the glow uses the same position.
      </p>
    </section>
  );
}
