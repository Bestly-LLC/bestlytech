import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { field } from "@/pages/admin/laxUi";
import type { ContactHit } from "@/lib/email/api";

const SOURCE: Record<ContactHit["source"], string> = { client: "Client", icloud: "iCloud", recent: "Recent" };

/** Wraps the part of `text` that matches `q` so the eye lands on why this row is here. */
function mark(text: string, q: string): ReactNode {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-[#0A84FF]/30 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * A text field with contact type-ahead (ARIA combobox). Typing asks `suggest` for matches; picking one calls `onPick`
 * so the parent can fill the name AND the email together. With no `suggest` it is a plain input.
 */
export function ContactField({ label, value, onText, onPick, suggest, disabled, placeholder, inputMode, className }: {
  label: ReactNode; value: string; onText: (v: string) => void; onPick: (hit: ContactHit) => void;
  suggest?: (q: string) => Promise<ContactHit[]>; disabled?: boolean; placeholder?: string; inputMode?: "email"; className?: string;
}) {
  const uid = useId();
  const inputId = `${uid}-in`, listId = `${uid}-list`;
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [q, setQ] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seq = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => () => { clearTimeout(timer.current); seq.current++; }, []);
  useEffect(() => { if (disabled) { setOpen(false); } }, [disabled]);
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const close = () => { clearTimeout(timer.current); seq.current++; setOpen(false); setActive(-1); };

  const ask = (v: string) => {
    clearTimeout(timer.current);
    const term = v.trim();
    const my = ++seq.current;
    if (!suggest || !term) { setOpen(false); setHits([]); setActive(-1); return; }
    timer.current = setTimeout(() => {
      suggest(term).then((r) => {
        if (my !== seq.current) return;
        setQ(term); setHits(r); setActive(-1); setOpen(r.length > 0);
      }).catch(() => { if (my === seq.current) setOpen(false); });
    }, 150);
  };

  const pick = (h: ContactHit) => { close(); onPick(h); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hits.length) return;
      e.preventDefault();
      if (!open) { setOpen(true); setActive(e.key === "ArrowDown" ? 0 : hits.length - 1); return; }
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % hits.length : (a <= 0 ? hits.length - 1 : a - 1)));
    } else if (e.key === "Enter" && open && active >= 0 && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); pick(hits[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault(); e.stopPropagation(); close();
    }
  };

  return (
    <div className="relative">
      <label htmlFor={inputId} className="block text-[13px] text-white/60">{label}</label>
      <input
        id={inputId} value={value} disabled={disabled} inputMode={inputMode} placeholder={placeholder} autoComplete="off" autoCorrect="off" spellCheck={false}
        role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { onText(e.target.value); ask(e.target.value); }}
        onKeyDown={onKeyDown}
        onBlur={close}
        className={cn(field, "mt-1", className)}
      />
      <span className="sr-only" role="status" aria-live="polite">{open ? `${hits.length} ${hits.length === 1 ? "suggestion" : "suggestions"}` : ""}</span>
      {open && hits.length > 0 && (
        <ul
          ref={listRef} id={listId} role="listbox" aria-label="Suggested contacts"
          className="sf-menu-in absolute inset-x-0 top-full z-30 mt-1.5 max-h-[276px] overflow-y-auto overscroll-contain rounded-[14px] bg-[#2C2C2E]/95 py-1 shadow-[0_12px_40px_rgba(0,0,0,.55)] ring-1 ring-white/[0.12] backdrop-blur-xl"
        >
          {hits.map((h, i) => (
            <li
              key={`${h.email}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} onMouseMove={() => active !== i && setActive(i)}
              className={cn("flex min-h-[44px] cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3.5 py-1.5", i === active ? "bg-[#0A84FF]/25" : "hover:bg-white/[0.06]")}
            >
              <span className="min-w-0 flex-[1_1_12rem]">
                {h.name ? (
                  <>
                    <span className="block text-[15px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">{mark(h.name, q)}</span>
                    <span className="block text-[13px] leading-snug text-[#EBEBF599] [overflow-wrap:anywhere]">{mark(h.email, q)}</span>
                  </>
                ) : (
                  <span className="block text-[15px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">{mark(h.email, q)}</span>
                )}
              </span>
              <span className="shrink-0 text-[12px] font-medium text-[#EBEBF599]">
                {SOURCE[h.source] ?? h.source}
                {h.source === "client" && h.detail && <Fragment><span aria-hidden="true"> · </span><span className="font-normal">{h.detail}</span></Fragment>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
