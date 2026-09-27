/**
 * bestly.tech/sign — guests sign Jared's projection wall from their phone.
 *
 * Draw with a finger, pick a color, add a name, send. The signature is stored by the
 * public wall_sign RPC (validated + rate limited in the database), which also pushes it
 * live to the wall; the page pings the wall's side channel as a backup.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";

const COLORS = ["#FFD166", "#FF6B9A", "#7BDFF2", "#C3A6FF", "#9BF6A1", "#FF9F6B", "#FFFFFF"];
const ASPECT = 1.7; // canvas width / height

type Stroke = number[]; // flat [x, y, x, y, …] in canvas CSS pixels

function deviceId(): string {
  try {
    let id = localStorage.getItem("bestly-sign-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("bestly-sign-device", id);
    }
    return id;
  } catch {
    return "";
  }
}

export default function SignWall() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [name, setName] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const [phase, setPhase] = useState<"draw" | "sending" | "done">("draw");
  const [error, setError] = useState<string | null>(null);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    for (const st of [...strokes.current, ...(drawing.current ? [drawing.current] : [])]) {
      if (st.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(st[0], st[1]);
      if (st.length === 2) ctx.lineTo(st[0] + 0.1, st[1]);
      for (let i = 2; i < st.length - 2; i += 2) {
        ctx.quadraticCurveTo(st[i], st[i + 1], (st[i] + st[i + 2]) / 2, (st[i + 1] + st[i + 3]) / 2);
      }
      if (st.length > 2) ctx.lineTo(st[st.length - 2], st[st.length - 1]);
      ctx.stroke();
    }
  }, [color]);

  // size the canvas to its box (sharp on retina)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [redraw, phase]);

  useEffect(() => { redraw(); }, [color, redraw]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = point(e);
    redraw();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = drawing.current;
    if (!st) return;
    const [x, y] = point(e);
    const dx = x - st[st.length - 2], dy = y - st[st.length - 1];
    if (dx * dx + dy * dy < 9) return; // skip jitter under 3px
    st.push(x, y);
    redraw();
  };
  const up = () => {
    const st = drawing.current;
    drawing.current = null;
    if (st && strokes.current.length < 80) {
      strokes.current.push(st);
      setHasInk(true);
    }
    redraw();
  };

  const clear = () => {
    strokes.current = [];
    drawing.current = null;
    setHasInk(false);
    setError(null);
    redraw();
  };

  const send = async () => {
    const c = canvasRef.current;
    if (!c || !strokes.current.length) return;
    const w = c.getBoundingClientRect().width;
    const k = 1000 / w; // x and y share the width scale, so the drawing keeps its shape
    const norm = strokes.current
      .map((st) => st.map((v) => Math.max(0, Math.min(1000, Math.round(v * k)))))
      .map((st) => (st.length === 2 ? [st[0], st[1], st[0] + 1, st[1]] : st))
      .filter((st) => st.length >= 4);
    setPhase("sending");
    setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await (supabase.rpc as any)("wall_sign", {
        p_name: name.trim(),
        p_strokes: norm,
        p_color: color,
        p_aspect: ASPECT,
        p_device: deviceId(),
      });
      if (err) throw new Error(err.message);
      const ping = (data as { ping?: string } | null)?.ping;
      if (ping) {
        try {
          const ch = supabase.channel(ping);
          await ch.send({ type: "broadcast", event: "sign", payload: { id: (data as { id?: number }).id } });
          void supabase.removeChannel(ch);
        } catch {
          /* the database already pushed it live; this is only a backup nudge */
        }
      }
      setPhase("done");
      if (navigator.vibrate) navigator.vibrate(30);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg.includes("slow down") ? "Easy, one sec. Try again in a moment." : "That didn't go through. Try again?");
      setPhase("draw");
    }
  };

  const again = () => {
    clear();
    setPhase("draw");
  };

  return (
    <main className="min-h-[100dvh] bg-black text-white antialiased [font-feature-settings:'ss01']">
      <Helmet>
        <title>Sign the wall</title>
        <meta name="robots" content="noindex" />
        <meta name="theme-color" content="#000000" />
      </Helmet>
      <style>{`
        @keyframes sw-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @keyframes sw-pop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes sw-draw { to { stroke-dashoffset: 0; } }
        .sw-rise { animation: sw-rise .7s cubic-bezier(.2,.8,.2,1) both; }
      `}</style>
      <div className="mx-auto flex max-w-md flex-col px-5 pb-10 pt-[max(28px,env(safe-area-inset-top))]">
        {phase !== "done" ? (
          <>
            <header className="sw-rise">
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/45">Bestly Wall</p>
              <h1 className="mt-1 text-[34px] font-bold leading-[1.05] tracking-[-0.02em]">Sign the wall</h1>
              <p className="mt-2 text-[17px] leading-snug text-white/60">
                Sign with your finger. It shows up on the wall in a few seconds.
              </p>
            </header>

            <div className="sw-rise mt-6" style={{ animationDelay: "80ms" }}>
              <div className="relative overflow-hidden rounded-[22px] bg-white/[0.06] ring-1 ring-white/10" style={{ aspectRatio: String(ASPECT) }}>
                <canvas
                  ref={canvasRef}
                  aria-label="Signature pad. Draw with your finger."
                  className="absolute inset-0 h-full w-full touch-none"
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                />
                {!hasInk && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[17px] text-white/30">
                    Sign here
                  </div>
                )}
                <div className="pointer-events-none absolute bottom-[22%] left-[8%] right-[8%] h-px bg-white/15" />
              </div>

              <div className="mt-4 flex items-center justify-between gap-2" role="radiogroup" aria-label="Ink color">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    aria-label={`Color ${c}`}
                    onClick={() => setColor(c)}
                    className="flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90"
                  >
                    <span
                      className="block h-8 w-8 rounded-full transition-all"
                      style={{
                        background: c,
                        boxShadow: color === c ? `0 0 0 3px #000, 0 0 0 5px ${c}, 0 0 18px ${c}` : "none",
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>

            <label className="sw-rise mt-5 block" style={{ animationDelay: "140ms" }}>
              <span className="text-[13px] font-medium text-white/50">Your name (optional)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 32))}
                autoComplete="given-name"
                enterKeyHint="done"
                placeholder="First name"
                className="mt-1.5 h-12 w-full rounded-[14px] bg-white/[0.08] px-4 text-[17px] text-white placeholder:text-white/30 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-white/40"
              />
            </label>

            {error && <p role="alert" className="mt-3 text-[15px] text-[#FF6B6B]">{error}</p>}

            <div className="sw-rise mt-6 flex gap-3" style={{ animationDelay: "200ms" }}>
              <button
                type="button"
                onClick={clear}
                disabled={!hasInk || phase === "sending"}
                className="h-[52px] flex-1 rounded-[16px] bg-white/[0.1] text-[17px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={send}
                disabled={!hasInk || phase === "sending"}
                className="h-[52px] flex-[2] rounded-[16px] text-[17px] font-semibold text-black transition active:scale-[0.98] disabled:opacity-40"
                style={{ background: color }}
              >
                {phase === "sending" ? "Sending…" : "Send to the wall"}
              </button>
            </div>
          </>
        ) : (
          <section className="flex min-h-[80dvh] flex-col items-center justify-center text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full" style={{ background: color, animation: "sw-pop .7s cubic-bezier(.2,.8,.2,1) both", boxShadow: `0 0 60px ${color}` }}>
              <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: "sw-draw .5s .35s ease-out forwards" }} />
              </svg>
            </div>
            <h2 className="sw-rise mt-7 text-[30px] font-bold tracking-[-0.02em]" style={{ animationDelay: "250ms" }}>You're on the wall</h2>
            <p className="sw-rise mt-2 text-[17px] text-white/60" style={{ animationDelay: "330ms" }}>Look up. It's writing itself right now.</p>
            <button type="button" onClick={again} className="sw-rise mt-9 h-[52px] rounded-[16px] bg-white/[0.1] px-7 text-[17px] font-semibold active:scale-[0.98]" style={{ animationDelay: "420ms" }}>
              Sign again
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
