/**
 * Trip navigation for the guest pages:
 *  - TagBar: sticky bottom bar with two buttons (Pickup / Return): boarding passes on LAX, midcentury tiles at home.
 *  - TripSheet: bottom sheet with the steps. Close with the X, the backdrop, Escape,
 *    or by dragging the three-bar handle down (like closing a suitcase lid).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PlaneLanding, PlaneTakeoff, X } from "lucide-react";

const PEACH = "var(--trip-accent, #FFB878)"; // themeable: the home page sets WeHo colors

type Which = "pickup" | "return";

/** LAX: a boarding pass. Main part (Arriving / Pickup), a perforated tear line with punched notches, and a stub
 *  with the route like a flight (LAX → CAR, CAR → LAX). */
function Tag({ which, active, onClick }: { which: Which; active: boolean; onClick: () => void }) {
  const pickup = which === "pickup";
  const Icon = pickup ? PlaneLanding : PlaneTakeoff;
  const bg = pickup ? PEACH : "var(--trip-accent-2, #E4527A)";
  const notch = "var(--trip-notch, #150d38)";
  return (
    <button type="button" onClick={onClick} aria-expanded={active} aria-label={pickup ? "Pickup steps" : "Return steps"}
      className="relative flex h-[60px] flex-1 overflow-hidden rounded-[12px] text-left text-[#1A1140] shadow-lg shadow-black/30 transition active:scale-[0.97] motion-reduce:transition-none"
      style={{ background: bg }}>
      <span className="flex min-w-0 flex-1 items-center gap-2 pl-3 pr-1">
        <Icon className="h-6 w-6 shrink-0" strokeWidth={2} aria-hidden />
        <span className="min-w-0">
          <span className="block text-[9px] font-bold uppercase tracking-[0.18em] opacity-60">{pickup ? "Arriving" : "Leaving"}</span>
          <span className="block text-[17px] font-bold leading-tight">{pickup ? "Pickup" : "Return"}</span>
        </span>
      </span>
      {/* tear line: dashed, with half-circle punches top and bottom */}
      <span aria-hidden className="relative w-0 border-l-2 border-dashed border-[#1A1140]/30">
        <span className="absolute -left-[8px] -top-[7px] h-[14px] w-[14px] rounded-full" style={{ background: notch }} />
        <span className="absolute -bottom-[7px] -left-[8px] h-[14px] w-[14px] rounded-full" style={{ background: notch }} />
      </span>
      <span aria-hidden className="flex w-[52px] shrink-0 flex-col items-center justify-center font-mono leading-none">
        <span className="text-[12px] font-bold tracking-wider">{pickup ? "LAX" : "CAR"}</span>
        <span className="my-[3px] text-[9px] opacity-60">▼</span>
        <span className="text-[12px] font-bold tracking-wider">{pickup ? "CAR" : "LAX"}</span>
      </span>
    </button>
  );
}

/** Home pickup: midcentury tiles (mustard / burnt orange) with an atomic star. */
function Ticket({ which, active, onClick }: { which: Which; active: boolean; onClick: () => void }) {
  const pickup = which === "pickup";
  return (
    <button type="button" onClick={onClick} aria-expanded={active}
      className="relative flex h-[60px] flex-1 items-center gap-3 overflow-hidden rounded-[18px] pl-4 pr-3 text-left text-[#132726] shadow-lg shadow-black/40 transition active:scale-[0.97] motion-reduce:transition-none"
      style={{ background: pickup ? "var(--trip-accent, #E8A93A)" : "var(--trip-accent-2, #E36F3C)" }}>
      <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full border-[6px] border-[#F4EAD5]/35" />
      <svg viewBox="-10 -10 20 20" className="h-6 w-6 shrink-0 text-[#F4EAD5]" aria-hidden><polygon points="0,-10 1.6,-1.6 10,0 1.6,1.6 0,10 -1.6,1.6 -10,0 -1.6,-1.6" fill="currentColor" /></svg>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">{pickup ? "Arriving" : "Leaving"}</span>
        <span className="block text-[19px] font-bold leading-tight" style={{ fontFamily: "'Josefin Sans', Futura, 'Avenir Next', sans-serif" }}>{pickup ? "Pickup" : "Return"}</span>
      </span>
    </button>
  );
}

export function TagBar({ open, onOpen, top, variant, hideTags, glow, badge }: { open: Which | null; onOpen: (w: Which) => void; top?: ReactNode; variant?: "lax" | "home"; hideTags?: boolean; glow?: Which | null; badge?: string }) {
  // The ticket for the next step glows (same running light as the next-step card); "Key ready" badge on Pickup.
  const wrap = (w: Which, el: ReactNode) => (
    <span className={`relative flex flex-1 ${variant === "home" ? "rounded-[18px]" : "rounded-[12px]"} ${glow === w ? "trip-glow" : ""}`}>
      {el}
      {w === "pickup" && badge && <span className="pointer-events-none absolute -top-2.5 right-2 z-10 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[#1A1140] shadow-md">{badge}</span>}
    </span>
  );
  return (
    <nav aria-label="Trip steps" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[color:var(--trip-bar,rgba(20,12,51,0.9))] backdrop-blur-md"
      style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
      {/* luggage strap across the bar */}
      <div aria-hidden className="h-[3px] w-full" style={{ background: "var(--trip-strap, repeating-linear-gradient(90deg, #FFB87855 0 10px, transparent 10px 16px))" }} />
      {top && <div className="mx-auto max-w-md px-4 pt-2.5">{top}</div>}
      {!hideTags && <div className="mx-auto flex max-w-md gap-3 px-4 pt-2.5">
        {wrap("pickup", variant === "home" ? <Ticket which="pickup" active={open === "pickup"} onClick={() => onOpen("pickup")} /> : <Tag which="pickup" active={open === "pickup"} onClick={() => onOpen("pickup")} />)}
        {wrap("return", variant === "home" ? <Ticket which="return" active={open === "return"} onClick={() => onOpen("return")} /> : <Tag which="return" active={open === "return"} onClick={() => onOpen("return")} />)}
      </div>}
    </nav>
  );
}

export function TripSheet({ open, onClose, children, title, kicker, footer, bodyRef }: { open: boolean; onClose: () => void; children: ReactNode; title: string; kicker: string; footer?: ReactNode; bodyRef?: React.Ref<HTMLDivElement> }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<{ y: number; t: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // lock page scroll + Escape to close + focus the sheet
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  useEffect(() => { if (!open) setDrag(0); }, [open]);

  const down = (e: React.PointerEvent) => { start.current = { y: e.clientY, t: Date.now() }; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const move = (e: React.PointerEvent) => { if (start.current) setDrag(Math.max(0, e.clientY - start.current.y)); };
  const up = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y, v = dy / Math.max(1, Date.now() - start.current.t);
    start.current = null;
    if (dy > 110 || v > 0.6) onClose(); else setDrag(0);
  };

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div onClick={onClose} className={`absolute inset-0 bg-black/55 transition-opacity duration-300 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] max-w-md flex-col rounded-t-[28px] bg-[color:var(--trip-bg,#1A1140)] shadow-2xl shadow-black/60 outline-none ring-1 ring-white/10 motion-reduce:transition-none"
        style={{
          transform: open ? `translateY(${drag}px)` : "translateY(105%)",
          transition: start.current ? "none" : "transform 320ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* Grab area: three-bar handle + suitcase-style header. Drag down to close. */}
        <div className="shrink-0 cursor-grab touch-none select-none rounded-t-[28px] px-5 pb-3 pt-2.5 active:cursor-grabbing"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ background: "var(--trip-sheet-head, linear-gradient(180deg, #2B1A73, #1A1140))" }}>
          <div className="mx-auto flex w-10 flex-col gap-[4px] py-1.5" aria-hidden>
            <span className="h-[3px] rounded-full bg-white/45" /><span className="h-[3px] rounded-full bg-white/45" /><span className="h-[3px] rounded-full bg-white/45" />
          </div>
          <div className="mt-1 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: PEACH }}>{kicker}</p>
              <h2 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-white">{title}</h2>
            </div>
            <button type="button" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} aria-label="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/15 active:scale-95">
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* luggage strap under the header */}
          <div aria-hidden className="mt-3 h-[3px] rounded-full" style={{ background: "var(--trip-strap, repeating-linear-gradient(90deg, #FFB87866 0 10px, transparent 10px 16px))" }} />
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-4" style={{ paddingBottom: footer ? 16 : "max(32px, env(safe-area-inset-bottom))" }}>
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-white/10 px-4 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>{footer}</div>}
      </div>
    </div>
  );
}
