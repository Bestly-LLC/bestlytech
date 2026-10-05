/**
 * CollapsibleSection: one header row for every "set it and forget it" card on both Ava pages (/admin/ava and /admin/roofguard).
 *
 *   - Title, an icon, and a one-line summary that shows while the section is closed ("Calendars · Personal, iCloud Home · OK").
 *   - A chevron that turns when it opens (still while "reduce motion" is on: it just jumps).
 *   - The whole header is one 44px+ button with aria-expanded and aria-controls, so it works with the keyboard and a screen reader.
 *   - Open or closed is remembered per section in localStorage (every read and write is wrapped, a blocked store just means "use the default").
 *   - The body is only rendered while open; the section component keeps its own data hooks above this, so the summary stays current when closed.
 *   - openSignal: bump the number to open it from outside (the voice switcher's "More voices" link).
 * Always-open areas (Messages, All calls, live calls) do not use this on purpose.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const KEY = (id: string) => `bestly.ava.section.${id}`;
const read = (id: string): boolean | null => { try { const v = window.localStorage.getItem(KEY(id)); return v === "1" ? true : v === "0" ? false : null; } catch { return null; } };
const write = (id: string, open: boolean) => { try { window.localStorage.setItem(KEY(id), open ? "1" : "0"); } catch { /* storage blocked: fine */ } };

export function CollapsibleSection({ id, anchorId, title, icon, summary, badge, defaultOpen = false, openSignal, className, bodyClassName, children }: {
  id: string; anchorId?: string; title: ReactNode; icon?: ReactNode; summary?: ReactNode; badge?: ReactNode; defaultOpen?: boolean; openSignal?: number;
  className?: string; bodyClassName?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => read(id) ?? defaultOpen);
  const uid = useId();
  const bodyId = `${uid}-body`, titleId = `${uid}-title`;
  useEffect(() => { if (openSignal) { setOpen(true); write(id, true); } }, [openSignal, id]);
  const toggle = () => setOpen((o) => { write(id, !o); return !o; });
  return (
    <section id={anchorId} aria-labelledby={titleId} className={cn("rounded-3xl bg-white/[0.03] ring-1 ring-white/10", className)}>
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={bodyId}
        className="flex min-h-[56px] w-full items-center gap-3 rounded-3xl px-4 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none">
        {icon && <span className="shrink-0" aria-hidden>{icon}</span>}
        <span className="min-w-0 flex-1">
          <span id={titleId} className="block text-[15px] font-semibold text-white">{title}</span>
          {!open && summary ? <span className="mt-0.5 block text-xs text-white/60 [overflow-wrap:anywhere]">{summary}</span> : null}
        </span>
        {badge ? <span className="shrink-0">{badge}</span> : null}
        <ChevronRight className={cn("h-5 w-5 shrink-0 text-white/55 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
      </button>
      {open && (
        <div id={bodyId} role="region" aria-labelledby={titleId} className={cn("border-t border-white/5", bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}
