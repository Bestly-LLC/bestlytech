/**
 * Luggage-themed trip navigation for the LAX guest page:
 *  - TagBar: sticky bottom bar with two luggage-tag buttons (Pickup / Return).
 *  - TripSheet: bottom sheet with the steps. Close with the X, the backdrop, Escape,
 *    or by dragging the three-bar handle down (like closing a suitcase lid).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BaggageClaim, Car, House, PlaneTakeoff, X } from "lucide-react";

const PEACH = "#FFB878";

type Which = "pickup" | "return";

/** A luggage tag: punched eyelet, strap loop, stitched edge. */
function Tag({ which, active, onClick, home }: { which: Which; active: boolean; onClick: () => void; home?: boolean }) {
  const pickup = which === "pickup";
  const Icon = home ? (pickup ? Car : House) : pickup ? BaggageClaim : PlaneTakeoff;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className="group relative flex h-[60px] flex-1 items-center gap-2.5 rounded-[14px] pl-9 pr-3 text-left shadow-lg shadow-black/30 transition active:scale-[0.97] motion-reduce:transition-none"
      style={{
        background: pickup ? PEACH : "#EDE7FF",
        color: "#1A1140",
        // notched tag corners on the eyelet side
        clipPath: "polygon(14px 0, 100% 0, 100% 100%, 14px 100%, 0 calc(100% - 14px), 0 14px)",
      }}
    >
      {/* stitching */}
      <span aria-hidden className="pointer-events-none absolute inset-[4px] rounded-[11px] border border-dashed border-[#1A1140]/30"
        style={{ clipPath: "polygon(11px 0, 100% 0, 100% 100%, 11px 100%, 0 calc(100% - 11px), 0 11px)" }} />
      {/* eyelet + strap */}
      <span aria-hidden className="absolute left-[11px] top-1/2 h-[12px] w-[12px] -translate-y-1/2 rounded-full bg-[#1A1140] ring-[3px] ring-[#1A1140]/25" />
      <Icon className="h-6 w-6 shrink-0" strokeWidth={2} aria-hidden />
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.16em] opacity-60">{pickup ? "Arriving" : "Leaving"}</span>
        <span className="block text-[17px] font-bold leading-tight">{pickup ? "Pickup" : "Return"}</span>
      </span>
    </button>
  );
}

export function TagBar({ open, onOpen, top, variant }: { open: Which | null; onOpen: (w: Which) => void; top?: ReactNode; variant?: "lax" | "home" }) {
  return (
    <nav aria-label="Trip steps" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#140c33]/90 backdrop-blur-md"
      style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
      {/* luggage strap across the bar */}
      <div aria-hidden className="h-[3px] w-full" style={{ background: `repeating-linear-gradient(90deg, ${PEACH}55 0 10px, transparent 10px 16px)` }} />
      {top && <div className="mx-auto max-w-md px-4 pt-2.5">{top}</div>}
      <div className="mx-auto flex max-w-md gap-3 px-4 pt-2.5">
        <Tag which="pickup" home={variant === "home"} active={open === "pickup"} onClick={() => onOpen("pickup")} />
        <Tag which="return" home={variant === "home"} active={open === "return"} onClick={() => onOpen("return")} />
      </div>
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
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] max-w-md flex-col rounded-t-[28px] bg-[#1A1140] shadow-2xl shadow-black/60 outline-none ring-1 ring-white/10 motion-reduce:transition-none"
        style={{
          transform: open ? `translateY(${drag}px)` : "translateY(105%)",
          transition: start.current ? "none" : "transform 320ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* Grab area: three-bar handle + suitcase-style header. Drag down to close. */}
        <div className="shrink-0 cursor-grab touch-none select-none rounded-t-[28px] px-5 pb-3 pt-2.5 active:cursor-grabbing"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ background: "linear-gradient(180deg, #2B1A73, #1A1140)" }}>
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
          <div aria-hidden className="mt-3 h-[3px] rounded-full" style={{ background: `repeating-linear-gradient(90deg, ${PEACH}66 0 10px, transparent 10px 16px)` }} />
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-4" style={{ paddingBottom: footer ? 16 : "max(32px, env(safe-area-inset-bottom))" }}>
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-white/10 px-4 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>{footer}</div>}
      </div>
    </div>
  );
}
