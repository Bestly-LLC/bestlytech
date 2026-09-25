/**
 * Collapsible card for the trip pages (LAX + Home). Header is one big tap target; the body folds with a
 * grid-rows transition (no height measuring, no layout jank). Open/closed is remembered per section.
 * Anything that jumps to the section (#id, or window event "open-section" with detail = id) opens it.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Lines } from "./Lines";

const load = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v == null ? d : v === "1"; } catch { return d; } };

export function Collapse({ id, kicker, title, summary, defaultOpen = true, children, className = "", style, titleStyle, accent = "var(--trip-accent)" }: {
  id: string; kicker: string; title?: ReactNode; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode;
  className?: string; style?: CSSProperties; titleStyle?: CSSProperties; accent?: string;
}) {
  const key = `fold:${id}`;
  const [open, setOpen] = useState(() => load(key, defaultOpen));
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = body.current; if (!el) return; if (open) el.removeAttribute("inert"); else el.setAttribute("inert", ""); }, [open]);
  const set = useCallback((v: boolean) => { setOpen(v); try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* private mode */ } }, [key]);
  useEffect(() => {
    const onHash = () => { if (location.hash === `#${id}`) set(true); };
    const onOpen = (e: Event) => { if ((e as CustomEvent).detail === id) set(true); };
    onHash();
    window.addEventListener("hashchange", onHash);
    window.addEventListener("open-section", onOpen);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("open-section", onOpen); };
  }, [id, set]);
  return (
    <section id={id} className={`mt-6 scroll-mt-4 rounded-3xl bg-white/[0.06] ring-1 ring-white/10 ${className}`} style={style}>
      <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => set(!open)}
        className="flex w-full items-start justify-between gap-3 rounded-3xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: accent }}>{kicker}</span>
          {title && <span className="mt-1 block text-[20px] font-bold leading-snug text-white" style={titleStyle}><Lines>{title}</Lines></span>}
          {!open && summary && <span className="mt-1 block text-[13px] text-white/60"><Lines>{summary}</Lines></span>}
        </span>
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.08]">
          <ChevronDown className={`h-4 w-4 text-white/70 transition-transform duration-300 ${open ? "rotate-180" : ""}`} aria-hidden />
        </span>
      </button>
      <div id={`${id}-body`} className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div ref={body} className="min-h-0 overflow-hidden">
          <div className="px-4 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
