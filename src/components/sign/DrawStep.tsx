/** Step 1 (landscape): a wide signature pad on the left, name + ink color + send on the right. */
import { useCallback, useEffect, useRef, useState } from "react";

export const COLORS = ["#FFD166", "#FF6B9A", "#7BDFF2", "#C3A6FF", "#9BF6A1", "#FF9F6B", "#FFFFFF", "#FF5E5E"];

/** times: one array per stroke, one integer per point = ms since the first touch of the signature (the wall replays
 *  the signature at the speed it was written). Parallel to strokes. */
export type DrawResult = { name: string; color: string; strokes: number[][]; times: number[][]; aspect: number };

type Stroke = number[];

export default function DrawStep({
  sending, error, banner, onSend,
}: {
  sending: boolean;
  error: string | null;
  banner: string | null;
  onSend: (r: DrawResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const times = useRef<number[][]>([]);          // parallel to strokes: ms per point
  const drawingT = useRef<number[] | null>(null);
  const t0 = useRef<number | null>(null);        // first touch of this signature
  const [color, setColor] = useState(COLORS[0]);
  const [name, setName] = useState("");
  const [hasInk, setHasInk] = useState(false);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
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
      for (let i = 2; i < st.length - 2; i += 2) ctx.quadraticCurveTo(st[i], st[i + 1], (st[i] + st[i + 2]) / 2, (st[i + 1] + st[i + 3]) / 2);
      if (st.length > 2) ctx.lineTo(st[st.length - 2], st[st.length - 1]);
      ctx.stroke();
    }
  }, [color]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let last = { w: 0, h: 0 };
    const fit = () => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // the box changed size (rotation, toolbar): rescale existing ink so it keeps its place
      if (last.w && (Math.abs(last.w - r.width) > 1) && strokes.current.length) {
        const k = r.width / last.w;
        strokes.current = strokes.current.map((st) => st.map((v) => v * k));
      }
      last = { w: r.width, h: r.height };
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [redraw]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = point(e);
    const now = performance.now();
    if (t0.current === null) t0.current = now;
    drawingT.current = [Math.round(now - t0.current)];
    redraw();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = drawing.current;
    if (!st) return;
    const [x, y] = point(e);
    const dx = x - st[st.length - 2], dy = y - st[st.length - 1];
    if (dx * dx + dy * dy < 9) return;
    st.push(x, y);
    drawingT.current?.push(Math.round(performance.now() - (t0.current ?? performance.now())));
    redraw();
  };
  const up = () => {
    const st = drawing.current, tt = drawingT.current;
    drawing.current = null;
    drawingT.current = null;
    if (st && strokes.current.length < 80) {
      strokes.current.push(st);
      times.current.push(tt && tt.length * 2 === st.length ? tt : st.map((_, i) => i).filter((i) => i % 2 === 0).map(() => 0));
      setHasInk(true);
    }
    redraw();
  };
  const clear = () => {
    strokes.current = [];
    times.current = [];
    t0.current = null;
    drawing.current = null;
    drawingT.current = null;
    setHasInk(false);
    redraw();
  };

  const send = () => {
    const c = canvasRef.current;
    if (!c || !strokes.current.length) return;
    const r = c.getBoundingClientRect();
    const k = 1000 / r.width; // x and y share the width scale, so the drawing keeps its shape
    let pts = 0;
    const norm: number[][] = [], tms: number[][] = [];
    strokes.current.forEach((raw, si) => {
      let st = raw.map((v) => Math.max(0, Math.min(1000, Math.round(v * k))));
      let tt = (times.current[si] || []).map((v) => Math.max(0, Math.min(600000, Math.round(v))));
      if (tt.length * 2 !== st.length) tt = st.filter((_, i) => i % 2 === 0).map(() => 0);
      if (st.length === 2) { st = [st[0], st[1], st[0] + 1, st[1]]; tt = [tt[0] ?? 0, (tt[0] ?? 0) + 16]; }
      if (st.length < 4) return;
      if (st.length > 400) {
        // keep under the server's 8,000-number cap by thinning very long strokes (every other point, always the last)
        const keep = (p: number, n: number) => p % 2 === 0 || p === n - 1;
        const n = st.length / 2;
        st = st.filter((_, i) => keep(Math.floor(i / 2), n));
        tt = tt.filter((_, p) => keep(p, n));
      }
      pts += st.length;
      norm.push(st);
      tms.push(tt);
    });
    if (pts > 8000 || !norm.length) return;
    onSend({ name: name.trim(), color, strokes: norm, times: tms, aspect: Math.max(0.5, Math.min(4, r.width / r.height)) });
  };

  return (
    <div className="flex h-full min-h-0 gap-3">
      <section className="sw-rise relative min-w-0 flex-1 overflow-hidden rounded-[22px] bg-white/[0.06] ring-1 ring-white/10">
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[20px] font-medium text-white/30">Sign here</div>
        )}
        <div className="pointer-events-none absolute bottom-[20%] left-[6%] right-[6%] h-px bg-white/15" />
        {banner && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-[13px] text-white/70 ring-1 ring-white/10">{banner}</div>
        )}
      </section>

      <aside className="sw-rise flex w-[232px] shrink-0 flex-col gap-2.5" style={{ animationDelay: "60ms" }}>
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">Sign the wall</h1>
        <label className="block">
          <span className="sr-only">Your first name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 32))}
            autoComplete="given-name"
            enterKeyHint="done"
            placeholder="First name (optional)"
            className="h-11 w-full rounded-[12px] bg-white/[0.08] px-3.5 text-[17px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-2 focus:ring-white/40"
          />
        </label>
        <div className="grid grid-cols-4" role="radiogroup" aria-label="Ink color">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Ink color ${c}`}
              onClick={() => setColor(c)}
              className="flex h-11 items-center justify-center rounded-full transition-transform active:scale-90"
            >
              <span
                className="block h-8 w-8 rounded-full transition-shadow"
                style={{ background: c, boxShadow: color === c ? `0 0 0 3px #000, 0 0 0 5px ${c}, 0 0 16px ${c}` : "none" }}
              />
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-[15px] leading-snug text-[#FF6B6B]">{error}</p>}
        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={clear}
            disabled={!hasInk || sending}
            className="h-12 w-[84px] rounded-[14px] bg-white/[0.1] text-[17px] font-semibold text-white transition active:scale-[0.97] disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!hasInk || sending}
            className="h-12 flex-1 rounded-[14px] text-[17px] font-semibold text-black transition active:scale-[0.97] disabled:opacity-40"
            style={{ background: color }}
          >
            {sending ? "Sending…" : "Send to wall"}
          </button>
        </div>
      </aside>
    </div>
  );
}
